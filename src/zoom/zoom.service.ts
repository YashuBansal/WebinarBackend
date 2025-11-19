import { HttpService } from '@nestjs/axios';
import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotAcceptableException,
  BadRequestException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model, Types } from 'mongoose';
import { firstValueFrom } from 'rxjs';
import {
  ZoomProject,
  ZoomProjectDocument,
} from './schemas/zoom-project.schema';
import { ZoomMeetingEventType } from './schemas/zoom-meeting-event.schema';
import { ZoomWebhookEvent } from './enums/zoom-webhook-event.enum';
import * as crypto from 'crypto';
import { ZoomEventService } from './zoom-event/zoom-event.service';
import { ValidationUtil } from 'src/common/utils/validation.util';
import { MonitoringUtil } from 'src/common/utils/monitoring.util';
import { WebinarService } from '../webinar/webinar.service';
import { UsersService } from 'src/users/users.service';
import { MeetingEventConfigService } from 'src/meeting-event-config/meeting-event-config.service';
import { ConfiguredTemplatesService } from 'src/configured-templates/configured-templates.service';
import { WhatsappService } from 'src/whatsapp/whatsapp.service';
import axios from 'axios';
import { AttendeesService } from 'src/attendees/attendees.service';
import { BooleanExpression } from 'mongoose';
import { WebhookQueueService } from './webhook-queue.service';
import { WhatsAppGateway } from 'src/websocket/whatsapp.gateway';

@Injectable()
export class ZoomService implements OnModuleInit {
  private readonly logger = new Logger(ZoomService.name);
  constructor(
    private readonly http: HttpService,
    @InjectModel(ZoomProject.name)
    private readonly zoomProjectModel: Model<ZoomProjectDocument>,
    private readonly zoomEventService: ZoomEventService,
    private readonly webinarService: WebinarService,
    private readonly config: ConfigService,
    private readonly meetingEventConfigService: MeetingEventConfigService,
    private readonly ConfiguredTemplateService: ConfiguredTemplatesService,
    private readonly whatsappService: WhatsappService,
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
    @Inject(forwardRef(() => AttendeesService))
    private readonly attendeesService: AttendeesService,
    private readonly webhookQueueService: WebhookQueueService,
    private readonly whatsAppGateway: WhatsAppGateway,
  ) {}

  onModuleInit() {
    // Set the processing worker for the queue
    this.webhookQueueService.setProcessingWorker(
      (payload: any, projectId: string) => this.processWebhookPayloadV2(payload, projectId)
    );
    this.logger.log('Webhook queue processing worker registered');
  }

  // ====== Access Token Utilities ======
  private async refreshAccessTokenForProject(project: ZoomProjectDocument) {
    const tokenEndpoint = 'https://zoom.us/oauth/token';

    // Path 1: If we have a refresh token (Authorization Code flow), use it
    if (project?.refreshToken) {
      const clientId = this.config.get<string>('ZOOM_CLIENT_ID');
      const clientSecret = this.config.get<string>('ZOOM_CLIENT_SECRET');
      const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString(
        'base64',
      );
      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: project.refreshToken,
      });

      const { data } = await firstValueFrom(
        this.http.post(tokenEndpoint, params.toString(), {
          headers: {
            Authorization: `Basic ${authHeader}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }),
      );

      project.accessToken = data.access_token;
      project.refreshToken = data.refresh_token ?? project.refreshToken;
      project.accessTokenExpiresAt = new Date(
        Date.now() + (data.expires_in ?? 0) * 1000,
      );
      await project.save();
      return project;
    }

    // Path 2: Server-to-Server OAuth (account_credentials) does NOT return refresh_token.
    // Re-acquire an access token using stored clientId/clientSecret/accountId.
    if (project?.clientId && project?.clientSecret && project?.accountId) {
      const authHeader = Buffer.from(
        `${project.clientId}:${project.clientSecret}`,
      ).toString('base64');
      const params = new URLSearchParams({
        grant_type: 'account_credentials',
        account_id: project.accountId,
      });

      const { data } = await firstValueFrom(
        this.http.post(tokenEndpoint, params.toString(), {
          headers: {
            Authorization: `Basic ${authHeader}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }),
      );

      project.accessToken = data.access_token;
      // No refresh token expected here
      project.accessTokenExpiresAt = new Date(
        Date.now() + (data.expires_in ?? 0) * 1000,
      );
      await project.save();
      return project;
    }

    throw new NotAcceptableException(
      'No method available to refresh Zoom access token',
    );
  }

  private isAccessTokenExpired(project?: ZoomProjectDocument | null) {
    if (!project?.accessTokenExpiresAt) return false;
    // Add a small clock skew to be safe
    const skewMs = 60_000;
    return project.accessTokenExpiresAt.getTime() - skewMs <= Date.now();
  }

  private async ensureValidAccessToken(project: ZoomProjectDocument) {
    if (this.isAccessTokenExpired(project)) {
      await this.refreshAccessTokenForProject(project);
    }
    return project;
  }

  private async executeWithTokenRetry<T>(
    project: ZoomProjectDocument,
    fn: (token: string) => Promise<T>,
  ): Promise<T> {
    // Ensure not expired before first call
    const current = await this.ensureValidAccessToken(project);
    try {
      return await fn(current.accessToken!);
    } catch (error: any) {
      const status = error?.response?.status;
      const code = error?.response?.data?.code;
      const err = error?.response?.data;
      // Zoom returns 401 with code 124 when token expired
      const isExpired401 = status === 401 && code === 124;
      // Zoom may return 400 invalid_grant/invalid_token for dead tokens
      const isInvalidGrant =
        status === 400 &&
        (err?.error === 'invalid_grant' ||
          err?.error === 'invalid_token' ||
          /invalid token/i.test(err?.reason || ''));
      if (isExpired401 || isInvalidGrant) {
        await this.refreshAccessTokenForProject(project);
        return await fn(project.accessToken!);
      }
      throw error;
    }
  }

  async exchangeCodeAndSave(
    code: string,
    adminId: Types.ObjectId,
    redirectUri: string,
    projectId: Types.ObjectId,
  ) {
    if (!code || !adminId) {
      throw new NotAcceptableException('Code and admin are required');
    }

    const clientId = this.config.get<string>('ZOOM_CLIENT_ID');
    const clientSecret = this.config.get<string>('ZOOM_CLIENT_SECRET');
    const tokenEndpoint = 'https://zoom.us/oauth/token';
    console.log(clientId, clientSecret, tokenEndpoint);

    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString(
      'base64',
    );
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });

    let data: any;
    try {
      const response = await firstValueFrom(
        this.http.post(tokenEndpoint, params.toString(), {
          headers: {
            Authorization: `Basic ${authHeader}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }),
      );
      data = response.data;
      console.log(data);
    } catch (error: any) {
      const status = error?.response?.status;
      const payload =
        error?.response?.data ?? error?.message ?? 'Unknown error';
      // Log full error for diagnostics
      console.error('Zoom token exchange failed:', { status, payload });
      throw new NotAcceptableException(
        'Failed to exchange authorization code with Zoom',
      );
    }

    const expiresAt = new Date(Date.now() + (data.expires_in ?? 0) * 1000);

    // Get user profile to extract account_id
    let accountId: string;
    try {
      const profileResponse = await firstValueFrom(
        this.http.get('https://api.zoom.us/v2/users/me', {
          headers: {
            Authorization: `Bearer ${data.access_token}`,
          },
        }),
      );
      accountId = profileResponse.data.account_id;
      console.log('Retrieved account ID:', accountId);
    } catch (error: any) {
      console.error(
        'Failed to get user profile:',
        error?.response?.data || error?.message,
      );
      // If we can't get account_id, we'll still save the tokens but without accountId
      accountId = '';
    }

    const doc = await this.zoomProjectModel.findOneAndUpdate(
      { _id: projectId, adminId },
      {
        accountId: accountId || undefined,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        accessTokenExpiresAt: expiresAt,
        isConfigured: true,
      },
      { new: true },
    );
    return doc;
  }

  async listAccounts(adminId: Types.ObjectId) {
    return this.zoomProjectModel.find({ adminId }).select('-accessToken');
  }

  async disconnectAccount(adminId: Types.ObjectId, accountId: string) {
    return this.zoomProjectModel.findOneAndDelete({ adminId, accountId });
  }

  async refreshAccessToken(adminId: Types.ObjectId, accountId: string) {
    const doc = await this.zoomProjectModel.findOne({ adminId, accountId });
    if (!doc?.refreshToken)
      throw new NotAcceptableException('No refresh token found');

    const clientId = this.config.get<string>('ZOOM_CLIENT_ID');
    const clientSecret = this.config.get<string>('ZOOM_CLIENT_SECRET');
    const tokenEndpoint = 'https://zoom.us/oauth/token';
    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString(
      'base64',
    );
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: doc.refreshToken,
    });

    const { data } = await firstValueFrom(
      this.http.post(tokenEndpoint, params.toString(), {
        headers: {
          Authorization: `Basic ${authHeader}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }),
    );

    doc.accessToken = data.access_token;
    doc.refreshToken = data.refresh_token ?? doc.refreshToken;
    doc.accessTokenExpiresAt = new Date(
      Date.now() + (data.expires_in ?? 0) * 1000,
    );
    await doc.save();
    return {
      accountId: doc.accountId,
      accessTokenExpiresAt: doc.accessTokenExpiresAt,
    };
  }

  async getZoomUserProfile(adminId: Types.ObjectId, accountId: string) {
    const doc = await this.zoomProjectModel.findOne({ adminId, accountId });
    if (!doc?.accessToken)
      throw new NotAcceptableException('No access token found');
    try {
      const data = await this.executeWithTokenRetry(doc, async (token) => {
        const resp = await firstValueFrom(
          this.http.get('https://api.zoom.us/v2/users/me', {
            headers: { Authorization: `Bearer ${token}` },
          }),
        );
        return resp.data;
      });
      return data;
    } catch (error: any) {
      const status = error?.response?.status;
      const payload =
        error?.response?.data ?? error?.message ?? 'Unknown error';
      console.error('Zoom user profile failed:', { status, payload });
      throw new NotAcceptableException('Failed to fetch Zoom profile');
    }
  }

  async getProjectMeetings(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    type: 'scheduled' | 'upcoming' | 'live' | 'past' | 'pending' = 'upcoming',
    options?: { pageSize?: number; from?: string; to?: string },
  ) {
    const project = await this.zoomProjectModel.findOne({
      _id: projectId,
      adminId,
    });
    if (!project?.accessToken)
      throw new NotAcceptableException('No access token found');

    let data: any;
    const pageSize = options?.pageSize ?? 30;
    try {
      data = await this.executeWithTokenRetry(project, async (token) => {
        const resp = await firstValueFrom(
          this.http.get('https://api.zoom.us/v2/users/me/meetings', {
            headers: { Authorization: `Bearer ${token}` },
            params: { type, page_size: pageSize },
          }),
        );
        return resp.data;
      });
    } catch (error: any) {
      const status = error?.response?.status;
      const payload =
        error?.response?.data ?? error?.message ?? 'Unknown error';
      console.error('Zoom list meetings failed:', { status, payload });
      throw new NotAcceptableException('Failed to fetch meetings from Zoom');
    }

    // Map to a light-weight shape expected by frontend
    let meetings = (data?.meetings ?? []).map((m: any) => ({
      id: String(m.id ?? m.uuid ?? ''),
      uuid: m.uuid,
      topic: m.topic,
      startTime: m.start_time,
      duration: m.duration,
      status: m.status,
      joinUrl: m.join_url,
      createdAt: m.created_at,
    }));

    // Optional date-range filter (inclusive) on startTime (fallback to createdAt)
    if (options?.from || options?.to) {
      const fromDate = options.from ? new Date(options.from) : undefined;
      const toDate = options.to ? new Date(options.to) : undefined;
      meetings = meetings.filter((m: any) => {
        const basisStr = m.startTime ?? m.createdAt;
        if (!basisStr) return false;
        const basis = new Date(basisStr).getTime();
        if (Number.isNaN(basis)) return false;
        if (fromDate && basis < fromDate.getTime()) return false;
        if (toDate && basis > toDate.getTime()) return false;
        return true;
      });
    }

    return {
      totalRecords: data?.total_records ?? 0,
      meetings,
    };
  }

  async getProjectWebinars(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    type: 'upcoming' = 'upcoming',
    options?: { pageSize?: number; from?: string; to?: string },
  ) {
    const project = await this.zoomProjectModel.findOne({
      _id: projectId,
      adminId,
    });
    if (!project?.accessToken)
      throw new NotAcceptableException('No access token found');

    let data: any;
    const pageSize = options?.pageSize ?? 30;
    try {
      data = await this.executeWithTokenRetry(project, async (token) => {
        const resp = await firstValueFrom(
          this.http.get('https://api.zoom.us/v2/users/me/webinars', {
            headers: { Authorization: `Bearer ${token}` },
            params: { type, page_size: pageSize },
          }),
        );
        return resp.data;
      });
    } catch (error: any) {
      const status = error?.response?.status;
      const payload =
        error?.response?.data ?? error?.message ?? 'Unknown error';
      console.error('Zoom list webinars failed:', { status, payload });
      throw new NotAcceptableException('Failed to fetch webinars from Zoom');
    }

    let webinars = (data?.webinars ?? []).map((w: any) => ({
      id: String(w.id ?? w.uuid ?? ''),
      uuid: w.uuid,
      topic: w.topic,
      startTime: w.start_time,
      duration: w.duration,
      status: w.status,
      joinUrl: w.join_url,
      createdAt: w.created_at,
    }));

    if (options?.from || options?.to) {
      const fromDate = options.from ? new Date(options.from) : undefined;
      const toDate = options.to ? new Date(options.to) : undefined;
      webinars = webinars.filter((w: any) => {
        const basisStr = w.startTime ?? w.createdAt;
        if (!basisStr) return false;
        const basis = new Date(basisStr).getTime();
        if (Number.isNaN(basis)) return false;
        if (fromDate && basis < fromDate.getTime()) return false;
        if (toDate && basis > toDate.getTime()) return false;
        return true;
      });
    }

    return {
      totalRecords: data?.total_records ?? 0,
      webinars,
    };
  }

  async getWebinarDetails(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    webinarId: string,
  ) {
    const project = await this.zoomProjectModel.findOne({
      _id: projectId,
      adminId,
    });
    if (!project?.accessToken)
      throw new NotAcceptableException('No access token found');

    try {
      const data = await this.executeWithTokenRetry(project, async (token) => {
        const resp = await firstValueFrom(
          this.http.get(
            `https://api.zoom.us/v2/webinars/${encodeURIComponent(webinarId)}`,
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          ),
        );
        return resp.data;
      });

      return {
        id: String(data?.id ?? data?.uuid ?? ''),
        uuid: data?.uuid,
        topic: data?.topic,
        startTime: data?.start_time,
        duration: data?.duration,
        status: data?.status,
        joinUrl: data?.join_url,
        createdAt: data?.created_at,
        hostId: data?.host_id,
        raw: data,
      };
    } catch (error: any) {
      const status = error?.response?.status;
      const payload =
        error?.response?.data ?? error?.message ?? 'Unknown error';
      console.error('Zoom webinar details failed:', { status, payload });
      throw new NotAcceptableException(
        'Failed to fetch webinar details from Zoom',
      );
    }
  }

  async getWebinarRegistrants(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    webinarId: string,
    status: 'pending' | 'approved' | 'denied' = 'approved',
    page: number,
    pageSize: number,
  ) {
    const project = await this.zoomProjectModel.findOne({
      _id: projectId,
      adminId,
    });
    if (!project?.accessToken)
      throw new NotAcceptableException('No access token found');

    try {
      this.logger.log(
        `getWebinarRegistrants --------==================------------- ${adminId} ${projectId} ${webinarId} webinar ${status} page: ${page} pageSize: ${pageSize}`,
      );

      const data = await this.executeWithTokenRetry(project, async (token) => {
        const resp = await firstValueFrom(
          this.http.get(
            `https://api.zoom.us/v2/webinars/${encodeURIComponent(webinarId)}/registrants`,
            {
              headers: { Authorization: `Bearer ${token}` },
              params: { status, page_size: pageSize, page_number: page },
            },
          ),
        );
        return resp.data;
      });
      console.log('data', data?.registrants?.length);
      let registrants = Array.isArray(data?.registrants)
        ? data?.registrants
        : [];

      // Match and merge with attendees data
      if (registrants.length > 0) {
        const attendeesResult =
          await this.attendeesService.fetchGroupedAttendees(adminId, 1, 1000, {
            emails: registrants.map((r: any) => r.email),
          });

        // Create a map of attendees by email (_id is the email after grouping)
        const attendeesMap = new Map(
          attendeesResult.data.map((attendee: any) => [
            attendee._id?.toLowerCase(),
            attendee,
          ]),
        );

        // Merge registrants with attendees data
        const mergedRegistrants = registrants.map((registrant: any) => {
          const email = registrant.email?.toLowerCase();
          const attendeeData = attendeesMap.get(email);

          return {
            ...registrant,
            attendeeData: attendeeData || null,
          };
        });

        // Return merged data with pagination metadata
        return {
          ...data,
          registrants: mergedRegistrants,
          pagination: {
            page: data.page_number || page,
            pageSize: data.page_size || pageSize,
            totalRecords: data.total_records || 0,
            pageCount: data.page_count || 0,
          },
        };
      }

      // Return data with pagination metadata even if no registrants
      return {
        ...data,
        pagination: {
          page: data.page_number || page,
          pageSize: data.page_size || pageSize,
          totalRecords: data.total_records || 0,
          pageCount: data.page_count || 0,
        },
      };
    } catch (error: any) {
      const status = error?.response?.status;
      const payload =
        error?.response?.data ?? error?.message ?? 'Unknown error';
      console.error('Zoom webinar registrants failed:', { status, payload });
      throw new NotAcceptableException(
        'Failed to fetch webinar registrants from Zoom',
      );
    }
  }

  async addWebinarRegistrant(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    webinarId: string,
    body: { email: string; first_name?: string; last_name?: string },
  ) {
    const project = await this.zoomProjectModel.findOne({
      _id: projectId,
      adminId,
    });
    if (!project?.accessToken)
      throw new NotAcceptableException('No access token found');

    try {
      const data = await this.executeWithTokenRetry(project, async (token) => {
        const resp = await firstValueFrom(
          this.http.post(
            `https://api.zoom.us/v2/webinars/${encodeURIComponent(webinarId)}/registrants`,
            body,
            { headers: { Authorization: `Bearer ${token}` } },
          ),
        );
        return resp.data;
      });

      return data;
    } catch (error: any) {
      const status = error?.response?.status;
      const payload =
        error?.response?.data ?? error?.message ?? 'Unknown error';
      console.error('Zoom add webinar registrant failed:', { status, payload });
      throw new NotAcceptableException('Failed to add webinar registrant');
    }
  }

  async validateWebhook(payload: any, projectId: Types.ObjectId) {
    const { plainToken } = payload.payload;

    if (!plainToken) {
      // Or handle the error as you see fit
      throw new Error('plainToken is missing in the validation payload.');
    }

    let realSecretToken: any;

    const secretToken = await this.zoomProjectModel
      .findOne({ _id: projectId })
      .select('secretToken');
    console.log('secretToken', secretToken, projectId, plainToken);
    if (secretToken && secretToken.secretToken) {
      realSecretToken = secretToken.secretToken;
    } else {
      realSecretToken = this.config.get<string>('ZOOM_CLIENT_SECRET_TOKEN');
    }

    if (!realSecretToken) {
      throw new Error('Zoom webhook secret token is not configured.');
    }

    const hash = crypto
      .createHmac('sha256', realSecretToken)
      .update(plainToken)
      .digest('hex');

    const response = {
      plainToken: plainToken,
      encryptedToken: hash,
    };

    console.log('response', response);

    return response;
  }

  private async notifyRegistrantsUpdate(
    projectId: string,
    meetingId: string,
    type: 'meeting' | 'webinar',
  ) {
    try {
      if (!projectId || !mongoose.isValidObjectId(projectId)) {
        this.logger.warn(
          `Skipping registrants update: invalid projectId ${projectId}`,
        );
        return;
      }

      const project = await this.zoomProjectModel
        .findById(projectId)
        .select('adminId')
        .lean();

      if (!project?.adminId) {
        this.logger.warn(
          `Unable to emit registrants update: project/admin missing`,
        );
        return;
      }

      const adminId = project.adminId.toString();
      this.logger.log(
        `Emitting registrants update for ${type} ${meetingId} to admin ${adminId}`,
      );
      this.whatsAppGateway.emitZoomRegistrantsUpdate(adminId, {
        projectId,
        meetingId,
        type,
      });
    } catch (error) {
      this.logger.error('Failed to emit registrants update:', error);
    }
  }

  async handleRegistrationCreated(
    meetingId: string,
    registrant: {
      id: string;
      first_name: string;
      last_name: string;
      email: string;
      phone: string;
    },
    projectId: string,
    type: 'meeting' | 'webinar',
  ) {
    console.log('Meeting registration created', registrant);

    try {
      // Use webinar service to handle the registration
      const result = await this.webinarService.handleMeetingRegistration(
        meetingId,
        registrant,
      );
      console.log('Registration handled:', result);

      // Emit socket event to refresh registrants data
      await this.notifyRegistrantsUpdate(projectId, meetingId, type);

      return result;
    } catch (error) {
      console.error('Error handling registration:', error);
      throw error;
    }
  }


  async handleMeetingCreated(projectId: string) {
    await this.notifyZoomRealtimeUpdate(projectId, 'meetings', 'created');
  }

  async handleWebinarCreated(projectId: string) {
    await this.notifyZoomRealtimeUpdate(projectId, 'webinars', 'created');
  }

  private async notifyZoomRealtimeUpdate(
    projectId: string,
    resource: 'meetings' | 'webinars',
    action: 'created' | 'updated' | 'deleted' | 'refetch',
  ) {
    try {
      if (!projectId || !mongoose.isValidObjectId(projectId)) {
        this.logger.warn(
          `Skipping realtime update for ${resource}: invalid projectId ${projectId}`,
        );
        return;
      }

      const project = await this.zoomProjectModel
        .findById(projectId)
        .select('adminId')
        .lean();

      if (!project?.adminId) {
        this.logger.warn(
          `Unable to emit realtime update for ${resource}: project/admin missing`,
        );
        return;
      }

      const adminId = project.adminId.toString();
      this.logger.log(
        `Emitting realtime ${resource} update (${action}) to admin ${adminId}`,
      );
      this.whatsAppGateway.emitZoomRealtimeEvent(adminId, {
        resource,
        action,
        projectId: projectId.toString(),
      });
    } catch (error) {
      this.logger.error(
        `Failed to emit realtime update for ${resource} (${action})`,
        error,
      );
    }
  }

  // In zoom.service.ts

  async processWebhookPayloadV2(payload: any, projectId: string | undefined) {
    const timer = MonitoringUtil.createTimer();
    try {
      const zoomProjectId = mongoose.isValidObjectId(projectId)
        ? new Types.ObjectId(projectId)
        : null;

      if (!zoomProjectId) {
        this.logger.error('Invalid project ID in webhook payload:', payload);
        return;
      }

      // Validate webhook payload structure
      ValidationUtil.validateWebhookPayload(payload);

      this.logger.log(` ========================= ${payload?.event} ========================= `);

      this.logger.log('Processing webhook payload:', {
        event: payload?.event,
        meetingId: payload?.payload?.object?.id || payload?.object?.id,
        timestamp: new Date().toISOString(),
        raw: payload,
      });

      // axios.post(`http://localhost:3002/api/v1/zoom/webhook-v2?projectId=${projectId}`, payload).then((response) => {
      //   // console.log('response', response);
      // }).catch((error) => {
      //   console.log('error', error);
      // });

      const event: string = payload?.event ?? '';
      const accountId: string | undefined =
        payload?.account_id || payload?.payload?.account_id;
      const object = payload?.payload?.object || payload?.object || {};
      const meetingId: string | undefined = String(
        object?.id || object?.uuid || '',
      );

      // Validate required fields
      if (!meetingId || meetingId === 'undefined' || meetingId === 'null') {
        this.logger.warn('Invalid meeting ID in webhook payload:', payload);
        return;
      }

      const participant = object?.participant || object?.participant_data || {};
      const registrant = object?.registrant || object?.registration || {};
      let eventType: ZoomMeetingEventType | undefined;

      // Route to the correct notification handler based on the event
      switch (event) {
        case ZoomWebhookEvent.MeetingCreated:
          await this.handleMeetingCreated(projectId);
          return;

        case ZoomWebhookEvent.WebinarCreated:
          await this.handleWebinarCreated(projectId);
          return;

        case ZoomWebhookEvent.MeetingStarted:
          const meetingTopic = ValidationUtil.sanitizeText(
            object?.topic || 'the meeting',
          );
          await this.handleMeetingStarted(meetingId, meetingTopic, false);
          eventType = ZoomMeetingEventType.MeetingStarted;
          break;

        case ZoomWebhookEvent.WebinarStarted:
          const webinarTopic = ValidationUtil.sanitizeText(
            object?.topic || 'the webinar',
          );
          await this.handleMeetingStarted(meetingId, webinarTopic, true);
          eventType = ZoomMeetingEventType.MeetingStarted;
          break;

        case ZoomWebhookEvent.MeetingParticipantJoined:
          const participantEmail = participant?.email;
          if (participantEmail) {
            try {
              ValidationUtil.validateEmail(participantEmail);
              await this.handleParticipantJoined(
                meetingId,
                participantEmail,
                false,
              );
            } catch (emailError) {
              this.logger.warn(
                `Invalid participant email in webhook: ${participantEmail}`,
                emailError.message,
              );
            }
          }
          eventType = ZoomMeetingEventType.ParticipantJoined;
          break;

        case ZoomWebhookEvent.WebinarParticipantJoined:
          const webinarParticipantEmail = participant?.email;
          if (webinarParticipantEmail) {
            try {
              ValidationUtil.validateEmail(webinarParticipantEmail);
              await this.handleParticipantJoined(
                meetingId,
                webinarParticipantEmail,
                true,
              );
            } catch (emailError) {
              this.logger.warn(
                `Invalid webinar participant email in webhook: ${webinarParticipantEmail}`,
                emailError.message,
              );
            }
          }
          eventType = ZoomMeetingEventType.ParticipantJoined;
          break;

        case ZoomWebhookEvent.MeetingParticipantLeft:
          const leftParticipant = object?.participant || {};
          await this.handleParticipantLeft(meetingId, leftParticipant, false);
          eventType = ZoomMeetingEventType.ParticipantLeft;
          break;

        case ZoomWebhookEvent.WebinarParticipantLeft:
          const webinarLeftParticipant = object?.participant || {};
          await this.handleParticipantLeft(
            meetingId,
            webinarLeftParticipant,
            true,
          );
          eventType = ZoomMeetingEventType.ParticipantLeft;
          break;

        case ZoomWebhookEvent.MeetingEnded:
          const endedMeetingTopic = ValidationUtil.sanitizeText(
            object?.topic || 'the meeting',
          );
          await this.handleMeetingEnded(meetingId, endedMeetingTopic, false);
          eventType = ZoomMeetingEventType.MeetingEnded;
          break;

        case ZoomWebhookEvent.WebinarEnded:
          const webinarEndedTopic = ValidationUtil.sanitizeText(
            object?.topic || 'the webinar',
          );
          await this.handleMeetingEnded(meetingId, webinarEndedTopic, true);
          eventType = ZoomMeetingEventType.MeetingEnded;
          break;

        case ZoomWebhookEvent.MeetingRegistrationCreated:
          await this.handleRegistrationCreated(meetingId, registrant, projectId, 'meeting');
          return;

        case ZoomWebhookEvent.WebinarRegistrationCreated:
          console.log('Webinar registration created', registrant);
          await this.handleRegistrationCreated(meetingId, registrant, projectId, 'webinar');
          return;

        default:
          this.logger.warn(`Unhandled webhook event: ${event}`);
          return;
      }

      // Create meeting event record
      if (eventType) {
        try {
          await this.zoomEventService.createMeetingEvent({
            accountId,
            meetingId,
            eventType,
            participantId: participant?.id,
            participantUserId: participant?.user_id,
            participantName: ValidationUtil.sanitizeText(
              participant?.user_name || participant?.name || '',
            ),
            participantEmail: participant?.email,
            raw: payload,
            projectId: zoomProjectId,
          });
        } catch (eventError) {
          this.logger.error(
            'Failed to create meeting event record:',
            eventError,
          );
          // Don't throw here as the main webhook processing succeeded
        }
      }

      this.logger.log(
        `Successfully processed webhook event: ${event} for meeting: ${meetingId}`,
      );

      // Log webhook processing metrics
      MonitoringUtil.logWebhookMetrics(event, meetingId, timer(), true);
    } catch (error) {
      this.logger.error('Failed to process webhook payload:', {
        error: error.message,
        payload: payload,
        stack: error.stack,
      });

      // Log failed webhook processing
      MonitoringUtil.logWebhookMetrics(
        payload?.event || 'unknown',
        payload?.payload?.object?.id || 'unknown',
        timer(),
        false,
      );

      // Don't throw the error for validation issues - these shouldn't be retried
      if (error instanceof BadRequestException) {
        this.logger.warn(
          'Webhook payload validation failed, ignoring:',
          error.message,
        );
        return;
      }

      // Throw error for queue retry mechanism
      // The queue will handle retries with exponential backoff
      throw error;
    }
  }

  async handleMeetingStarted(
    meetingId: string,
    meetingTopic: string,
    isWebinar: boolean,
  ) {
    try {
      this.logger.log(
        `Handling meeting started event for meeting: ${meetingId}, topic: ${meetingTopic}`,
      );

      // Validate inputs
      if (!meetingId || meetingId === 'undefined' || meetingId === 'null') {
        this.logger.warn('Invalid meeting ID provided to handleMeetingStarted');
        return;
      }

      const meetingEventConfig =
        await this.meetingEventConfigService.getMeetingEventConfig(meetingId);

      if (!meetingEventConfig) {
        this.logger.warn(
          `No meeting event config found for meeting: ${meetingId}`,
        );
        return;
      }

      this.logger.log(`Found meeting event config for meeting: ${meetingId}`);

      const { meetingStarted } = meetingEventConfig;

      if (!meetingStarted?.enabled) {
        this.logger.log(
          `Meeting started notifications disabled for meeting: ${meetingId}`,
        );
        return;
      }

      // Check if already executed
      if (meetingStarted.isExecuted) {
        this.logger.warn(
          `Meeting started event already executed for meeting: ${meetingId}. Skipping duplicate processing.`,
        );
        return;
      }

      if (!mongoose.isValidObjectId(meetingStarted.configuredTemplateId)) {
        this.logger.warn(
          `Invalid configured template ID for meeting: ${meetingId}`,
        );
        return;
      }

      const configuredTemplate =
        await this.ConfiguredTemplateService.getConfiguredTemplate(
          meetingStarted.configuredTemplateId,
        );

      if (!configuredTemplate) {
        this.logger.warn(
          `Configured template not found for meeting: ${meetingId}`,
        );
        return;
      }

      this.logger.log(
        `Using configured template: ${configuredTemplate.configuredTemplateName} for meeting: ${meetingId}`,
      );

      // Set isExecuted flag immediately to prevent duplicate processing
      await this.meetingEventConfigService.updateEventExecutedFlag(
        meetingId,
        'meetingStarted',
      );

      const registrations = await this.getMeetingRegistrations({
        meetingId,
        adminId: meetingEventConfig.adminId,
        projectId: meetingEventConfig.whatsappProjectId,
        webinarID: meetingEventConfig.webinarId,
        zoomProjectId: meetingEventConfig.zoomProjectId,
        isWebinar,
      });

      if (!registrations || registrations.length === 0) {
        this.logger.log(`No registrations found for meeting: ${meetingId}`);
        return;
      }

      this.logger.log(
        `Found ${registrations.length} registrations for meeting: ${meetingId}`,
      );

      // Send template messages with enhanced error handling
      const results = await this.whatsappService.sendTemplateMessages({
        fetchedContacts: registrations,
        template: configuredTemplate,
        meetingId,
      });

      this.logger.log(
        `Meeting started notifications completed for meeting: ${meetingId}. Results: ${results.successful}/${results.total} successful`,
      );

      if (results.failed > 0) {
        this.logger.warn(
          `Some notifications failed for meeting: ${meetingId}. Failed: ${results.failed}`,
        );
        results.errors.forEach((error) => {
          this.logger.warn(
            `Failed notification for contact ${error.contactId}: ${error.error}`,
          );
        });
      }
    } catch (error) {
      this.logger.error(
        `Failed to handle meeting started event for meeting: ${meetingId}`,
        {
          error: error.message,
          stack: error.stack,
          meetingTopic,
        },
      );
      // Don't throw to avoid breaking the webhook processing
    }
  }

  async getMeetingRegistrations(data: {
    meetingId: string;
    adminId: Types.ObjectId;
    projectId: Types.ObjectId;
    webinarID?: Types.ObjectId;
    zoomProjectId: Types.ObjectId;
    isWebinar: boolean;
  }) {
    if (mongoose.isValidObjectId(data.webinarID)) {
      const registrations = await this.webinarService.getWebinarRegistrations(
        data.webinarID,
        data.adminId,
      );
      if (Array.isArray(registrations)) return registrations;
    } else {
      const registrations = await this.getAllMeetingRegistrants(
        data.adminId,
        data.zoomProjectId,
        data.meetingId,
        data.isWebinar,
      );
      this.logger.log(
        `registration count ====> > ${registrations?.registrants?.length}`,
      );
      if (Array.isArray(registrations?.registrants))
        return registrations.registrants.map((registrant) => ({
          email: registrant.email,
          phone: registrant.phone,
          firstName: registrant.first_name,
          lastName: registrant.last_name,
        }));
    }

    return [];
  }

  async getMeetingAttendees(data: {
    meetingId: string;
    adminId: Types.ObjectId;
    projectId: Types.ObjectId;
    webinarID?: Types.ObjectId;
    zoomProjectId: Types.ObjectId;
    isWebinar: boolean;
  }) {
    // Get all registrations first
    const allRegistrations = await this.getMeetingRegistrations(data);

    // Get participants who actually joined the meeting
    const meetingEvents =
      await this.zoomEventService.getMeetingEventsByMeetingId(data.meetingId);
    const attendedEmails = new Set(
      meetingEvents
        .filter(
          (event) => event.eventType === ZoomMeetingEventType.ParticipantJoined,
        )
        .map((event) => event.participantEmail)
        .filter((email) => email),
    );

    // Filter registrations to only include those who attended
    return allRegistrations.filter(
      (registration) =>
        registration.email && attendedEmails.has(registration.email),
    );
  }

  async getMeetingNonAttendees(data: {
    meetingId: string;
    adminId: Types.ObjectId;
    projectId: Types.ObjectId;
    webinarID?: Types.ObjectId;
    zoomProjectId: Types.ObjectId;
    isWebinar: boolean;
  }) {
    // Get all registrations first
    const allRegistrations = await this.getMeetingRegistrations(data);

    // Get participants who actually joined the meeting
    const meetingEvents =
      await this.zoomEventService.getMeetingEventsByMeetingId(data.meetingId);
    const attendedEmails = new Set(
      meetingEvents
        .filter(
          (event) => event.eventType === ZoomMeetingEventType.ParticipantJoined,
        )
        .map((event) => event.participantEmail)
        .filter((email) => email),
    );

    // Filter registrations to only include those who did NOT attend
    return allRegistrations.filter(
      (registration) =>
        registration.email && !attendedEmails.has(registration.email),
    );
  }

  async getParticipantByEmail(data: {
    meetingId: string;
    adminId: Types.ObjectId;
    projectId: Types.ObjectId;
    webinarID?: Types.ObjectId;
    participantEmail: string;
    zoomProjectId: Types.ObjectId;
    isWebinar: boolean;
  }) {
    // Get all registrations first
    const allRegistrations = await this.getMeetingRegistrations(data);

    // Find the specific participant by email
    return allRegistrations.find(
      (registration) =>
        registration.email &&
        registration.email.toLowerCase() ===
          data.participantEmail.toLowerCase(),
    );
  }

  async handleParticipantJoined(
    meetingId: string,
    participantEmail: string,
    isWebinar: boolean,
  ) {}

  async handleParticipantLeft(
    meetingId: string,
    participantData: any,
    isWebinar: boolean,
  ) {
    try {
      this.logger.log(
        'handleParticipantLeft --------==================-------------',
        meetingId,
        participantData,
      );
      const meetingEventConfig =
        await this.meetingEventConfigService.getMeetingEventConfig(meetingId);
      this.logger.log(
        'meetingEventConfig --------==================-------------',
        meetingEventConfig,
      );
      if (!meetingEventConfig) return;

      const { participantLeft } = meetingEventConfig;
      this.logger.log(
        'participantLeft --------==================-------------',
        participantLeft,
      );
      if (
        !participantLeft.enabled ||
        !mongoose.isValidObjectId(participantLeft.configuredTemplateId)
      )
        return;

      const configuredTemplate =
        await this.ConfiguredTemplateService.getConfiguredTemplate(
          participantLeft.configuredTemplateId,
        );
      this.logger.log(
        'configuredTemplate --------==================-------------',
        configuredTemplate,
      );
      if (!configuredTemplate) return;

      // Get the specific participant who left
      const participant = await this.getParticipantByEmail({
        meetingId,
        adminId: meetingEventConfig.adminId,
        projectId: meetingEventConfig.whatsappProjectId,
        webinarID: meetingEventConfig.webinarId,
        participantEmail: participantData.email,
        zoomProjectId: meetingEventConfig.zoomProjectId,
        isWebinar,
      });
      this.logger.log(
        'participant --------==================-------------',
        participant,
      );
      if (!participant) return;

      await this.whatsappService.sendTemplateMessages({
        fetchedContacts: [participant],
        template: configuredTemplate,
        meetingId,
      });
      return;
    } catch (error) {
      this.logger.error('handleParticipantLeft failed:', error);
    }
  }

  async handleMeetingEnded(
    meetingId: string,
    meetingTopic: string,
    isWebinar: boolean,
  ) {
    try {
      this.logger.log(
        'handleMeetingEnded --------==================-------------',
        meetingId,
        meetingTopic,
      );
      const meetingEventConfig =
        await this.meetingEventConfigService.getMeetingEventConfig(meetingId);
      this.logger.log(
        'meetingEventConfig --------==================-------------',
        meetingEventConfig,
      );
      if (!meetingEventConfig) return;

      const { meetingEndedAttendees, meetingEndedNonAttendees } =
        meetingEventConfig;

      // Handle attendees messages
      if (
        meetingEndedAttendees.enabled &&
        mongoose.isValidObjectId(meetingEndedAttendees.configuredTemplateId)
      ) {
        // Check if already executed
        if (meetingEndedAttendees.isExecuted) {
          this.logger.warn(
            `Meeting ended attendees event already executed for meeting: ${meetingId}. Skipping duplicate processing.`,
          );
        } else {
          this.logger.log(
            'meetingEndedAttendees --------==================-------------',
            meetingEndedAttendees,
          );
          const configuredTemplate =
            await this.ConfiguredTemplateService.getConfiguredTemplate(
              meetingEndedAttendees.configuredTemplateId,
            );
          this.logger.log(
            'configuredTemplate for attendees --------==================-------------',
            configuredTemplate,
          );

          if (configuredTemplate) {
            // Set isExecuted flag immediately to prevent duplicate processing
            await this.meetingEventConfigService.updateEventExecutedFlag(
              meetingId,
              'meetingEndedAttendees',
            );

            const attendees = await this.getMeetingAttendees({
            meetingId,
            adminId: meetingEventConfig.adminId,
            projectId: meetingEventConfig.whatsappProjectId,
            webinarID: meetingEventConfig.webinarId,
            zoomProjectId: meetingEventConfig.zoomProjectId,
            isWebinar,
          });
            this.logger.log(
              'attendees --------==================-------------',
              attendees,
            );
            // Send messages even if attendees.length === 0 (flag already set)
            if (attendees.length > 0) {
              await this.whatsappService.sendTemplateMessages({
                fetchedContacts: attendees,
                template: configuredTemplate,
                meetingId,
              });
            } else {
              this.logger.log(
                `No attendees found for meeting: ${meetingId}. Flag already marked as executed.`,
              );
            }
          }
        }
      }

      // Handle non-attendees messages
      if (
        meetingEndedNonAttendees.enabled &&
        mongoose.isValidObjectId(meetingEndedNonAttendees.configuredTemplateId)
      ) {
        // Check if already executed
        if (meetingEndedNonAttendees.isExecuted) {
          this.logger.warn(
            `Meeting ended non-attendees event already executed for meeting: ${meetingId}. Skipping duplicate processing.`,
          );
        } else {
          this.logger.log(
            'meetingEndedNonAttendees --------==================-------------',
            meetingEndedNonAttendees,
          );
          const configuredTemplate =
            await this.ConfiguredTemplateService.getConfiguredTemplate(
              meetingEndedNonAttendees.configuredTemplateId,
            );
          this.logger.log(
            'configuredTemplate for non-attendees --------==================-------------',
            configuredTemplate,
          );

          if (configuredTemplate) {
            // Set isExecuted flag immediately to prevent duplicate processing
            await this.meetingEventConfigService.updateEventExecutedFlag(
              meetingId,
              'meetingEndedNonAttendees',
            );

            const nonAttendees = await this.getMeetingNonAttendees({
            meetingId,
            adminId: meetingEventConfig.adminId,
            projectId: meetingEventConfig.whatsappProjectId,
            webinarID: meetingEventConfig.webinarId,
            zoomProjectId: meetingEventConfig.zoomProjectId,
            isWebinar,
          });
            this.logger.log(
              'nonAttendees --------==================-------------',
              nonAttendees,
            );
            // Send messages even if nonAttendees.length === 0 (flag already set)
            if (nonAttendees.length > 0) {
              await this.whatsappService.sendTemplateMessages({
                fetchedContacts: nonAttendees,
                template: configuredTemplate,
                meetingId,
              });
            } else {
              this.logger.log(
                `No non-attendees found for meeting: ${meetingId}. Flag already marked as executed.`,
              );
            }
          }
        }
      }

      return;
    } catch (error) {
      this.logger.error('handleMeetingEnded failed:', error);
    }
  }

  async getMeetingDetails(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    meetingId: string,
  ) {
    const project = await this.zoomProjectModel.findOne({
      _id: projectId,
      adminId,
    });
    if (!project?.accessToken)
      throw new NotAcceptableException('No access token found');

    try {
      const data = await this.executeWithTokenRetry(project, async (token) => {
        const resp = await firstValueFrom(
          this.http.get(
            `https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}`,
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          ),
        );
        return resp.data;
      });
      return data;
    } catch (error: any) {
      const status = error?.response?.status;
      const payload =
        error?.response?.data ?? error?.message ?? 'Unknown error';
      console.error('Zoom meeting details failed:', { status, payload });
      throw new NotAcceptableException(
        'Failed to fetch meeting details from Zoom',
      );
    }
  }

  async getMeetingRegistrants(
    adminId: Types.ObjectId,
    zoomProjectId: Types.ObjectId,
    meetingId: string,
    isWebinar: boolean,
    page: number,
    pageSize: number,
    status: 'pending' | 'approved' | 'denied' = 'approved',
  ) {
    try {
      this.logger.log(
        `getMeetingRegistrants --------==================------------- ${adminId} ${zoomProjectId} ${meetingId} ${isWebinar ? 'webinar' : 'meeting'} ${status} page: ${page} pageSize: ${pageSize}`,
      );
      const project = await this.zoomProjectModel.findOne({
        _id: zoomProjectId,
        adminId,
      });
      if (!project?.accessToken)
        throw new NotAcceptableException('No access token found');

      // Use webinar endpoint if isWebinar is true, otherwise use meeting endpoint
      const endpoint = isWebinar
        ? `https://api.zoom.us/v2/webinars/${encodeURIComponent(meetingId)}/registrants`
        : `https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}/registrants`;

      const data = await this.executeWithTokenRetry(project, async (token) => {
        const resp = await firstValueFrom(
          this.http.get(endpoint, {
            headers: { Authorization: `Bearer ${token}` },
            params: { status, page_size: pageSize, page_number: page },
          }),
        );
        return resp.data;
      });

      console.log('data', data);
      let registrants = Array.isArray(data?.registrants)
        ? data?.registrants
        : [];

      // Match and merge with attendees data
      if (registrants.length > 0) {
        const attendeesResult =
          await this.attendeesService.fetchGroupedAttendees(adminId, 1, 1000, {
            emails: registrants.map((r: any) => r.email),
          });

        // Create a map of attendees by email (_id is the email after grouping)
        const attendeesMap = new Map(
          attendeesResult.data.map((attendee: any) => [
            attendee._id?.toLowerCase(),
            attendee,
          ]),
        );

        // Merge registrants with attendees data
        const mergedRegistrants = registrants.map((registrant: any) => {
          const email = registrant.email?.toLowerCase();
          const attendeeData = attendeesMap.get(email);

          return {
            ...registrant,
            attendeeData: attendeeData || null,
          };
        });

        // Return merged data with pagination metadata
        return {
          ...data,
          registrants: mergedRegistrants,
          pagination: {
            page: data.page_number || page,
            pageSize: data.page_size || pageSize,
            totalRecords: data.total_records || 0,
            pageCount: data.page_count || 0,
          },
        };
      }

      // Return data with pagination metadata even if no registrants
      return {
        ...data,
        pagination: {
          page: data.page_number || page,
          pageSize: data.page_size || pageSize,
          totalRecords: data.total_records || 0,
          pageCount: data.page_count || 0,
        },
      };
    } catch (error: any) {
      const status = error?.response?.status;
      const payload =
        error?.response?.data ?? error?.message ?? 'Unknown error';
      console.error(
        `Zoom ${isWebinar ? 'webinar' : 'meeting'} registrants fetch failed:`,
        { status, payload },
      );
      throw new NotAcceptableException(
        `Failed to fetch ${isWebinar ? 'webinar' : 'meeting'} registrants from Zoom`,
      );
    }
  }

  async getAllMeetingRegistrants(
    adminId: Types.ObjectId,
    zoomProjectId: Types.ObjectId,
    meetingId: string,
    isWebinar: boolean,
    status: 'pending' | 'approved' | 'denied' = 'approved',
  ) {
    try {
      this.logger.log(
        `getAllMeetingRegistrants --------==================------------- ${adminId} ${zoomProjectId} ${meetingId} ${isWebinar ? 'webinar' : 'meeting'} ${status}`,
      );
      const project = await this.zoomProjectModel.findOne({
        _id: zoomProjectId,
        adminId,
      });
      if (!project?.accessToken)
        throw new NotAcceptableException('No access token found');

      // Use webinar endpoint if isWebinar is true, otherwise use meeting endpoint
      const endpoint = isWebinar
        ? `https://api.zoom.us/v2/webinars/${encodeURIComponent(meetingId)}/registrants`
        : `https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}/registrants`;

      const MAX_PAGE_SIZE = 300;
      let allRegistrants: any[] = [];
      let currentPage = 1;
      let totalRecords = 0;
      let pageCount = 0;
      let pageSize = MAX_PAGE_SIZE;

      // Fetch all pages
      while (true) {
        const data = await this.executeWithTokenRetry(project, async (token) => {
          const resp = await firstValueFrom(
            this.http.get(endpoint, {
              headers: { Authorization: `Bearer ${token}` },
              params: {
                status,
                page_size: pageSize,
                page_number: currentPage,
              },
            }),
          );
          return resp.data;
        });

        const registrants = Array.isArray(data?.registrants)
          ? data?.registrants
          : [];

        allRegistrants = allRegistrants.concat(registrants);

        // Update pagination metadata from first page
        if (currentPage === 1) {
          totalRecords = data.total_records || 0;
          pageCount = data.page_count || 0;
          pageSize = data.page_size || MAX_PAGE_SIZE;
        }

        // Check if we've fetched all pages
        if (
          currentPage >= pageCount ||
          registrants.length === 0 ||
          allRegistrants.length >= totalRecords
        ) {
          break;
        }

        currentPage++;
      }

      this.logger.log(
        `getAllMeetingRegistrants fetched ${allRegistrants.length} total registrants across ${currentPage} page(s)`,
      );

      // Match and merge with attendees data
      if (allRegistrants.length > 0) {
        // Batch attendee lookups if needed (fetchGroupedAttendees has a limit)
        const BATCH_SIZE = 1000;
        const attendeesMap = new Map();

        for (let i = 0; i < allRegistrants.length; i += BATCH_SIZE) {
          const batch = allRegistrants.slice(i, i + BATCH_SIZE);
          const batchEmails = batch.map((r: any) => r.email).filter(Boolean);

          if (batchEmails.length > 0) {
            const attendeesResult =
              await this.attendeesService.fetchGroupedAttendees(
                adminId,
                1,
                1000,
                {
                  emails: batchEmails,
                },
              );

            // Add to map
            attendeesResult.data.forEach((attendee: any) => {
              attendeesMap.set(attendee._id?.toLowerCase(), attendee);
            });
          }
        }

        // Merge registrants with attendees data
        const mergedRegistrants = allRegistrants.map((registrant: any) => {
          const email = registrant.email?.toLowerCase();
          const attendeeData = attendeesMap.get(email);

          return {
            ...registrant,
            attendeeData: attendeeData || null,
          };
        });

        // Return merged data with pagination metadata
        return {
          registrants: mergedRegistrants,
          pagination: {
            page: 1,
            pageSize: allRegistrants.length,
            totalRecords: totalRecords || allRegistrants.length,
            pageCount: 1,
          },
        };
      }

      // Return data with pagination metadata even if no registrants
      return {
        registrants: [],
        pagination: {
          page: 1,
          pageSize: 0,
          totalRecords: totalRecords || 0,
          pageCount: 0,
        },
      };
    } catch (error: any) {
      const status = error?.response?.status;
      const payload =
        error?.response?.data ?? error?.message ?? 'Unknown error';
      console.error(
        `Zoom ${isWebinar ? 'webinar' : 'meeting'} all registrants fetch failed:`,
        { status, payload },
      );
      throw new NotAcceptableException(
        `Failed to fetch all ${isWebinar ? 'webinar' : 'meeting'} registrants from Zoom`,
      );
    }
  }

  async addMeetingRegistrant(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    meetingId: string,
    body: { email: string; first_name?: string; last_name?: string },
  ) {
    const project = await this.zoomProjectModel.findOne({
      _id: projectId,
      adminId,
    });
    if (!project?.accessToken)
      throw new NotAcceptableException('No access token found');

    try {
      const data = await this.executeWithTokenRetry(project, async (token) => {
        const resp = await firstValueFrom(
          this.http.post(
            `https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}/registrants`,
            body,
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          ),
        );
        return resp.data;
      });
      return data;
    } catch (error: any) {
      const status = error?.response?.status;
      const payload =
        error?.response?.data ?? error?.message ?? 'Unknown error';
      console.error('Zoom add registrant failed:', { status, payload });
      throw new NotAcceptableException('Failed to add meeting registrant');
    }
  }

  // ========== CRUD Methods for Zoom Projects ==========

  async getProjects(
    adminId: Types.ObjectId,
    page: number = 1,
    limit: number = 10,
    search?: string,
  ) {
    const skip = (page - 1) * limit;
    const query: any = { adminId };

    // Add search functionality if search term is provided
    if (search) {
      query.$or = [
        { projectName: { $regex: search, $options: 'i' } },
        { accountId: { $regex: search, $options: 'i' } },
      ];
    }

    const [projects, total] = await Promise.all([
      this.zoomProjectModel
        .find(query)
        .select('-accessToken') // Exclude sensitive data
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.zoomProjectModel.countDocuments(query),
    ]);

    return {
      projects,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getProject(adminId: Types.ObjectId, projectId: Types.ObjectId) {
    return this.zoomProjectModel
      .findOne({ _id: projectId, adminId })
      .select('-accessToken -refreshToken') // Exclude sensitive data
      .lean();
  }

  async createProject(
    adminId: Types.ObjectId,
    createProjectDto: {
      projectName: string;
      accountId?: string;
      accessToken?: string;
      refreshToken?: string;
      accessTokenExpiresAt?: Date;
    },
  ) {
    const project = new this.zoomProjectModel({
      adminId,
      ...createProjectDto,
    });

    const savedProject = await project.save();
    return this.zoomProjectModel
      .findById(savedProject._id)
      .select('-accessToken') // Exclude sensitive data
      .lean();
  }

  async updateProject(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    updateProjectDto: {
      projectName?: string;
      accountId?: string;
      accessToken?: string;
      refreshToken?: string;
      accessTokenExpiresAt?: Date;
    },
  ) {
    const updatedProject = await this.zoomProjectModel
      .findOneAndUpdate(
        { _id: projectId, adminId },
        { $set: updateProjectDto },
        { new: true },
      )
      .select('-accessToken') // Exclude sensitive data
      .lean();

    return updatedProject;
  }

  async deleteProject(adminId: Types.ObjectId, projectId: Types.ObjectId) {
    const deletedProject = await this.zoomProjectModel.findOneAndDelete({
      _id: projectId,
      adminId,
    });

    return !!deletedProject;
  }

  async getProjectByAccountId(adminId: Types.ObjectId, accountId: string) {
    return this.zoomProjectModel
      .findOne({ adminId, accountId })
      .select('-accessToken') // Exclude sensitive data
      .lean();
  }

  /**
   * Validate S2S OAuth credentials by calling Zoom token endpoint using account_credentials grant type
   * If successful, create a ZoomProject with tokens and mark as configured
   */
  async validateAndCreateProjectWithCredentials(
    adminId: Types.ObjectId,
    payload: {
      projectName: string;
      accountId: string;
      clientId: string;
      clientSecret: string;
      secretToken?: string;
    },
  ) {
    const userSubscription: any = await this.usersService.getUserSubscription(
      adminId.toString(),
    );
    if (!userSubscription) {
      throw new NotAcceptableException('User not found');
    }

    const projectCount = await this.zoomProjectModel.countDocuments({
      adminId,
    });

    if (userSubscription.plan.zoomProjectLimit <= projectCount) {
      throw new NotAcceptableException(
        'You have reached the limit of Zoom projects',
      );
    }

    const tokenEndpoint = 'https://zoom.us/oauth/token';
    const authHeader = Buffer.from(
      `${payload.clientId}:${payload.clientSecret}`,
    ).toString('base64');
    const params = new URLSearchParams({
      grant_type: 'account_credentials',
      account_id: payload.accountId,
    });

    let tokenData: any;
    try {
      const response = await firstValueFrom(
        this.http.post(tokenEndpoint, params.toString(), {
          headers: {
            Authorization: `Basic ${authHeader}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }),
      );
      tokenData = response.data;
    } catch (error: any) {
      const status = error?.response?.status;
      const payload =
        error?.response?.data ?? error?.message ?? 'Unknown error';
      console.error('Zoom credential validation failed:', { status, payload });
      throw new NotAcceptableException('Invalid Zoom credentials or account');
    }

    const expiresAt = new Date(Date.now() + (tokenData.expires_in ?? 0) * 1000);

    // Create project record with provided credentials and mark configured
    const project = new this.zoomProjectModel({
      adminId,
      projectName: payload.projectName,
      accountId: payload.accountId,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token, // may be undefined for some grants
      accessTokenExpiresAt: expiresAt,
      isConfigured: true,
      clientId: payload.clientId,
      clientSecret: payload.clientSecret,
      secretToken: payload.secretToken,
    });

    const saved = await project.save();
    return this.zoomProjectModel
      .findById(saved._id)
      .select('-accessToken -clientSecret')
      .lean();
  }

  // Additional utility methods

  async getProjectCount(adminId: Types.ObjectId) {
    return this.zoomProjectModel.countDocuments({ adminId });
  }

  async getProjectsByDateRange(
    adminId: Types.ObjectId,
    startDate: Date,
    endDate: Date,
  ) {
    return this.zoomProjectModel
      .find({
        adminId,
        createdAt: {
          $gte: startDate,
          $lte: endDate,
        },
      })
      .select('-accessToken') // Exclude sensitive data
      .sort({ createdAt: -1 })
      .lean();
  }

  async bulkDeleteProjects(
    adminId: Types.ObjectId,
    projectIds: Types.ObjectId[],
  ) {
    const result = await this.zoomProjectModel.deleteMany({
      _id: { $in: projectIds },
      adminId,
    });

    return result.deletedCount;
  }

  async getProjectConfigurationStatus(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
  ) {
    const project = await this.zoomProjectModel.findOne({
      _id: projectId,
      adminId,
    });

    if (!project) {
      return { isConfigured: false, missingFields: ['Project not found'] };
    }

    const missingFields: string[] = [];

    if (!project.accountId) missingFields.push('Account ID');
    if (!project.accessToken) missingFields.push('Access Token');

    return {
      isConfigured: missingFields.length === 0,
      missingFields,
      project: {
        _id: project._id,
        projectName: project.projectName,
        accountId: project.accountId,
        hasAccessToken: !!project.accessToken,
        // createdAt: project.createdAt,
        // updatedAt: project.updatedAt,
      },
    };
  }

  /**
   * Check webhook subscription status for a Zoom project
   */
  async checkWebhookSubscriptionStatus(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
  ): Promise<{ isSubscribed: boolean }> {
    const project = await this.zoomProjectModel.findOne({
      _id: projectId,
      adminId,
    });

    if (!project?.accessToken) {
      return { isSubscribed: false };
    }

    // Get webhook URL from config
    const webhookUrl =
      this.config.get<string>('EXTERNAL_WEBHOOK_URL') ||
      this.config.get<string>('ZOOM_WEBHOOK_URL');



    try {
      const data = await this.executeWithTokenRetry(project, async (token) => {
        const resp = await firstValueFrom(
          this.http.get('https://api.zoom.us/v2/webhooks', {
            headers: { Authorization: `Bearer ${token}` },
          }),
        );
        return resp.data;
      });

      // Check if our webhook URL exists in the subscriptions
      const subscriptions = data?.webhooks || [];
      console.log('subscriptions', subscriptions);

      if (!webhookUrl) {
        this.logger.warn('Webhook URL not configured in environment variables');
        return { isSubscribed: false };
      }
      const isSubscribed = subscriptions.some(
        (webhook: any) =>
          webhook.url === webhookUrl ||
          webhook.url?.includes(webhookUrl) ||
          webhookUrl.includes(webhook.url),
      );

      this.logger.log(
        `Webhook subscription status for project ${projectId}: ${isSubscribed ? 'Subscribed' : 'Not Subscribed'}`,
      );

      return { isSubscribed };
    } catch (error: any) {
      const status = error?.response?.status;
      const payload =
        error?.response?.data ?? error?.message ?? 'Unknown error';
      this.logger.error('Failed to check webhook subscription status', {
        status,
        payload,
        projectId: projectId.toString(),
      });
      // Return false on error to indicate not subscribed
      return { isSubscribed: false };
    }
  }
}
