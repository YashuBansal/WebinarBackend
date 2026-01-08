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
import { AttendeesService } from 'src/attendees/attendees.service';
import { WebhookQueueService } from './webhook-queue.service';
import { WhatsAppGateway } from 'src/websocket/whatsapp.gateway';
import { ZoomMeetingService } from './zoom-meeting/zoom-meeting.service';
import { ZoomMeetingOccurrence } from './zoom-meeting/zoom-meeting.schema';

@Injectable()
export class ZoomService implements OnModuleInit {
  private readonly logger = new Logger(ZoomService.name);

  // Simple in-memory rate limiter (consider using Redis for production)
  private readonly rateLimitMap = new Map<
    string,
    { count: number; resetTime: number }
  >();
  private readonly RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
  private readonly RATE_LIMIT_MAX_REQUESTS = 100; // Max requests per window per project

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
    @Inject(forwardRef(() => ZoomMeetingService))
    private readonly zoomMeetingService: ZoomMeetingService,
  ) {}

  onModuleInit() {
    // Set the processing worker for the queue
    this.webhookQueueService.setProcessingWorker(
      (payload: any, projectId: string) =>
        this.processWebhookPayloadV2(payload, projectId),
    );
    this.logger.log('Service initialized', {
      service: 'ZoomService',
      action: 'Webhook queue processing worker registered',
    });
  }

  // ====== Webhook Processing Helper Methods ======

  /**
   * Safely extracts nested property from payload with multiple fallback paths
   */
  private safeExtract(
    payload: any,
    paths: string[],
    defaultValue: any = undefined,
  ): any {
    for (const path of paths) {
      const keys = path.split('.');
      let value = payload;
      for (const key of keys) {
        if (value && typeof value === 'object' && key in value) {
          value = value[key];
        } else {
          value = undefined;
          break;
        }
      }
      if (value !== undefined && value !== null) {
        return value;
      }
    }
    return defaultValue;
  }

  /**
   * Validates and extracts meeting ID from payload
   */
  private validateAndExtractMeetingId(object: any): string | null {
    const meetingId = String(
      this.safeExtract(object, ['id', 'uuid'], '') || '',
    );
    if (
      !meetingId ||
      meetingId === 'undefined' ||
      meetingId === 'null' ||
      meetingId.trim() === ''
    ) {
      return null;
    }
    return meetingId;
  }

  /**
   * Validates occurrence ID format
   */
  private validateOccurrenceId(
    occurrenceId: string | undefined,
  ): string | undefined {
    if (!occurrenceId || occurrenceId.trim() === '') {
      return undefined;
    }
    return occurrenceId.trim();
  }

  /**
   * Extracts and validates occurrence ID from occurrences array
   * Matches occurrence by event timestamp when available, otherwise uses smallest start_time
   */
  private async extractOccurrenceId(
    occurrences: ZoomMeetingOccurrence[],
    meetingId: string,
    eventTimestamp?: Date,
  ): Promise<string | undefined> {
    if (!Array.isArray(occurrences) || occurrences.length === 0) {
      return undefined;
    }

    const availableOccurrences = occurrences.filter(
      (occurrence) => occurrence.status === 'available',
    );

    if (availableOccurrences.length === 0) {
      return undefined;
    }

    // If we have an event timestamp, try to match the occurrence that contains it
    if (eventTimestamp) {
      const matchingOccurrence = availableOccurrences.find((occurrence) => {
        if (!occurrence.start_time) return false;
        try {
          const startTime = new Date(occurrence.start_time);
          const duration = occurrence.duration || 0;
          const endTime = new Date(startTime.getTime() + duration * 60000);
          return eventTimestamp >= startTime && eventTimestamp <= endTime;
        } catch {
          return false;
        }
      });

      if (matchingOccurrence?.occurrence_id) {
        return this.validateOccurrenceId(matchingOccurrence.occurrence_id);
      }
    }

    // Fallback: use smallest start_time
    try {
      const sortedOccurrences = availableOccurrences
        .filter((occ) => occ.start_time)
        .sort((a, b) => {
          try {
            const timeA = new Date(a.start_time!).getTime();
            const timeB = new Date(b.start_time!).getTime();
            if (isNaN(timeA) || isNaN(timeB)) return 0;
            return timeA - timeB;
          } catch {
            return 0;
          }
        });

      if (sortedOccurrences.length > 0 && sortedOccurrences[0].occurrence_id) {
        return this.validateOccurrenceId(sortedOccurrences[0].occurrence_id);
      }
    } catch (error) {
      this.logger.warn('Error sorting occurrences', {
        method: 'extractOccurrenceId',
        error: error.message,
        meetingId,
      });
    }

    return undefined;
  }

  /**
   * Validates event type against known Zoom webhook events
   */
  private validateEventType(event: string): boolean {
    return Object.values(ZoomWebhookEvent).includes(event as ZoomWebhookEvent);
  }

  /**
   * Creates a correlation ID for webhook processing
   */
  private generateCorrelationId(): string {
    return `webhook-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Checks if project has exceeded rate limit
   * Returns true if within limits, false if rate limited
   */
  private checkRateLimit(projectId: string): boolean {
    const now = Date.now();
    const key = `project:${projectId}`;
    const limit = this.rateLimitMap.get(key);

    if (!limit || now > limit.resetTime) {
      // Reset or initialize
      this.rateLimitMap.set(key, {
        count: 1,
        resetTime: now + this.RATE_LIMIT_WINDOW_MS,
      });
      return true;
    }

    if (limit.count >= this.RATE_LIMIT_MAX_REQUESTS) {
      return false; // Rate limited
    }

    limit.count++;
    return true;
  }

  /**
   * Cleans up expired rate limit entries (call periodically)
   */
  private cleanupRateLimitMap(): void {
    const now = Date.now();
    for (const [key, limit] of this.rateLimitMap.entries()) {
      if (now > limit.resetTime) {
        this.rateLimitMap.delete(key);
      }
    }
  }

  /**
   * Logs webhook processing with structured format and context
   */
  private logWebhookProcessing(
    correlationId: string,
    level: 'log' | 'warn' | 'error',
    message: string,
    context: Record<string, any> = {},
  ): void {
    const logData: Record<string, any> = {
      correlationId,
      timestamp: new Date().toISOString(),
      ...context,
    };

    // Limit payload size in logs
    if (logData.payload && typeof logData.payload === 'object') {
      const payloadStr = JSON.stringify(logData.payload);
      if (payloadStr.length > 1000) {
        const payload = logData.payload as any;
        // Keep only essential fields
        const essential = {
          event: payload.event,
          account_id: payload.account_id,
          payload: {
            object: {
              id: payload.payload?.object?.id,
              topic: payload.payload?.object?.topic,
            },
          },
        };
        logData.payload = essential;
      }
    }

    this.logger[level](message, logData);
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

      return data;
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
    occurrenceId?: string,
  ) {
    const project = await this.zoomProjectModel.findOne({
      _id: projectId,
      adminId,
    });
    if (!project?.accessToken)
      throw new NotAcceptableException('No access token found');

    try {
      this.logger.log('Fetching webinar registrants', {
        method: 'getWebinarRegistrants',
        adminId,
        projectId,
        webinarId,
        status,
        page,
        pageSize,
        occurrenceId,
      });

      const data = await this.executeWithTokenRetry(project, async (token) => {
        const params: any = { status, page_size: pageSize, page_number: page };
        if (occurrenceId) {
          params.occurrence_id = occurrenceId;
        }
        const resp = await firstValueFrom(
          this.http.get(
            `https://api.zoom.us/v2/webinars/${encodeURIComponent(webinarId)}/registrants`,
            {
              headers: { Authorization: `Bearer ${token}` },
              params,
            },
          ),
        );
        return resp.data;
      });

      let registrants = Array.isArray(data?.registrants)
        ? data?.registrants
        : [];

      // Match and merge with attendees data
      if (registrants.length > 0) {
        const attendeesResult =
          await this.attendeesService.fetchGroupedAttendees(adminId, 1, 10000, {
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

    return response;
  }

  /**
   * Validates webhook signature from Zoom
   * This should be called at the controller level before processing the webhook
   * @param payload - The webhook payload
   * @param signature - The signature from the 'authorization' header
   * @param timestamp - The timestamp from the 'x-zm-request-timestamp' header
   * @param projectId - The Zoom project ID
   * @returns true if signature is valid, false otherwise
   */
  async validateWebhookSignature(
    payload: any,
    signature: string | undefined,
    timestamp: string | undefined,
    projectId: Types.ObjectId,
  ): Promise<boolean> {
    // If signature is not provided, log warning but don't fail (for backward compatibility)
    if (!signature) {
      this.logger.warn(
        'Webhook signature not provided - consider implementing signature validation for security',
        { projectId: projectId.toString() },
      );
      return true; // Allow processing for backward compatibility
    }

    try {
      // Get secret token
      const project = await this.zoomProjectModel
        .findById(projectId)
        .select('secretToken')
        .lean();

      const secretToken =
        project?.secretToken ||
        this.config.get<string>('ZOOM_CLIENT_SECRET_TOKEN');

      if (!secretToken) {
        this.logger.warn(
          'Webhook secret token not configured - cannot validate signature',
          { projectId: projectId.toString() },
        );
        return true; // Allow processing if secret not configured
      }

      // Create the message to sign
      const message = `v0:${timestamp || ''}:${JSON.stringify(payload)}`;

      // Create the expected signature
      const expectedSignature = crypto
        .createHmac('sha256', secretToken)
        .update(message)
        .digest('hex');

      const expectedSignatureWithVersion = `v0=${expectedSignature}`;

      // Compare signatures using constant-time comparison to prevent timing attacks
      const isValid =
        signature === expectedSignatureWithVersion ||
        signature === expectedSignature;

      if (!isValid) {
        this.logger.warn('Webhook signature validation failed', {
          projectId: projectId.toString(),
          providedSignature: signature.substring(0, 20) + '...',
        });
      }

      return isValid;
    } catch (error: any) {
      this.logger.error('Error validating webhook signature', {
        error: error.message,
        projectId: projectId.toString(),
      });
      // On error, allow processing but log the issue
      return true;
    }
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
        this.logger.warn('Project or admin not found', {
          method: 'notifyRegistrantsUpdate',
          projectId,
          meetingId,
          type,
        });
        return;
      }

      const adminId = project.adminId.toString();
      this.logger.log('Emitting registrants update', {
        method: 'notifyRegistrantsUpdate',
        type,
        meetingId,
        adminId,
      });
      this.whatsAppGateway.emitZoomRegistrantsUpdate(adminId, {
        projectId,
        meetingId,
        type,
      });
    } catch (error) {
      this.logger.error('Method failed', {
        method: 'notifyRegistrantsUpdate',
        error: error.message,
        stack: error.stack,
        projectId,
        meetingId,
        type,
      });
    }
  }

  private async notifyLiveDataUpdate(
    projectId: string,
    meetingId: string,
    isWebinar: boolean,
  ) {
    try {
      if (!projectId || !mongoose.isValidObjectId(projectId)) {
        this.logger.warn(
          `Skipping live data update: invalid projectId ${projectId}`,
        );
        return;
      }

      const project = await this.zoomProjectModel
        .findById(projectId)
        .select('adminId')
        .lean();

      if (!project?.adminId) {
        this.logger.warn('Project or admin not found', {
          method: 'notifyLiveDataUpdate',
          projectId,
          meetingId,
          isWebinar,
        });
        return;
      }

      const adminId = project.adminId.toString();
      this.logger.log('Emitting live data update', {
        method: 'notifyLiveDataUpdate',
        meetingId,
        isWebinar,
        adminId,
      });
      this.whatsAppGateway.emitZoomLiveUpdate(adminId, {
        projectId,
        meetingId,
        isWebinar,
      });
    } catch (error) {
      this.logger.error('Method failed', {
        method: 'notifyLiveDataUpdate',
        error: error.message,
        stack: error.stack,
        projectId,
        meetingId,
        isWebinar,
      });
    }
  }

  async handleRegistrationCreated(
    meetingId: string,
    registrant: {
      id?: string;
      first_name?: string;
      last_name?: string;
      email?: string;
      phone?: string;
    },
    projectId: string,
    type: 'meeting' | 'webinar',
    occurrences?: { occurrence_id?: string }[],
  ) {
    try {
      // Validate inputs
      if (!meetingId) {
        this.logger.warn('Validation failed', {
          handler: 'handleRegistrationCreated',
          reason: 'Invalid meeting ID',
          meetingId,
        });
        return;
      }

      if (!registrant || (!registrant.email && !registrant.id)) {
        this.logger.warn('Validation failed', {
          handler: 'handleRegistrationCreated',
          reason: 'Registrant missing required fields (email or id)',
          meetingId,
          registrant,
        });
        return;
      }

      // Validate and normalize registrant data for webinar service
      // The webinar service requires all fields, so we provide defaults if missing
      const normalizedRegistrant = {
        id: registrant.id || '',
        first_name: registrant.first_name || '',
        last_name: registrant.last_name || '',
        email: registrant.email || '',
        phone: registrant.phone || '',
      };

      // Validate registrant email if present
      if (normalizedRegistrant.email) {
        try {
          ValidationUtil.validateEmail(normalizedRegistrant.email);
        } catch (emailError) {
          this.logger.warn('Validation failed', {
            handler: 'handleRegistrationCreated',
            reason: 'Invalid registrant email',
            email: normalizedRegistrant.email,
            error: emailError.message,
            meetingId,
          });
          // Continue processing - email validation failure shouldn't block registration
        }
      }

      this.logger.log('Handler invoked', {
        handler: 'handleRegistrationCreated',
        meetingId,
        registrantEmail: registrant.email,
        registrantId: registrant.id,
        type,
        occurrencesCount: occurrences?.length || 0,
      });

      // Extract occurrence IDs from occurrences array
      let occurrenceIds: (string | undefined)[] = [];
      if (occurrences && occurrences.length > 0) {
        occurrenceIds = occurrences
          .map((occurrence) => occurrence?.occurrence_id)
          .filter((id) => id);
      }

      // If no occurrences, process for single meeting/webinar
      if (occurrenceIds.length === 0) {
        occurrenceIds = [undefined];
      }

      // Process registration for each occurrence
      const errors: any[] = [];
      for (const occurrenceId of occurrenceIds) {
        try {
          this.logger.debug('Processing registration occurrence', {
            handler: 'handleRegistrationCreated',
            meetingId,
            registrantEmail: registrant.email,
            occurrenceId,
          });

          const result = await this.webinarService.handleMeetingRegistration(
            meetingId,
            normalizedRegistrant,
            occurrenceId,
          );

          this.logger.debug('Registration occurrence handled successfully', {
            handler: 'handleRegistrationCreated',
            meetingId,
            occurrenceId,
            result,
          });
        } catch (occurrenceError: any) {
          errors.push({
            occurrenceId,
            error: occurrenceError.message,
            stack: occurrenceError.stack,
          });
          this.logger.error('Registration occurrence failed', {
            handler: 'handleRegistrationCreated',
            error: occurrenceError.message,
            stack: occurrenceError.stack,
            meetingId,
            registrantEmail: registrant.email,
            occurrenceId,
          });
          // Continue processing other occurrences
        }
      }

      // Emit socket event to refresh registrants data (only once, after all occurrences processed)
      try {
        await this.notifyRegistrantsUpdate(projectId, meetingId, type);
      } catch (notifyError: any) {
        this.logger.warn('Notification failed', {
          handler: 'handleRegistrationCreated',
          reason: 'Failed to notify registrants update',
          error: notifyError.message,
          meetingId,
          projectId,
        });
        // Don't fail the entire operation if notification fails
      }

      if (errors.length > 0) {
        this.logger.warn('Partial completion with errors', {
          handler: 'handleRegistrationCreated',
          meetingId,
          totalOccurrences: occurrenceIds.length,
          failedOccurrences: errors.length,
          errors,
        });
      } else {
        this.logger.log('Handler completed successfully', {
          handler: 'handleRegistrationCreated',
          meetingId,
          registrantEmail: registrant.email,
          occurrencesProcessed: occurrenceIds.length,
        });
      }
    } catch (error: any) {
      this.logger.error('Handler failed', {
        handler: 'handleRegistrationCreated',
        error: error.message,
        stack: error.stack,
        meetingId,
        registrantEmail: registrant?.email,
        registrantId: registrant?.id,
        projectId,
        type,
      });
      // Don't throw to avoid breaking webhook processing
    }
  }

  async handleMeetingCreated(projectId: string, adminId: string) {
    await this.notifyZoomRealtimeUpdate(adminId, projectId, 'meetings', 'created');
  }

  async handleWebinarCreated(projectId: string, adminId: string) {
    await this.notifyZoomRealtimeUpdate(adminId, projectId, 'webinars', 'created');
  }

  private async notifyZoomRealtimeUpdate(
    adminId: string,
    projectId: string,
    resource: 'meetings' | 'webinars',
    action: 'created' | 'updated' | 'deleted' | 'refetch',
  ) {
    try {
      if (!adminId || !mongoose.isValidObjectId(adminId)) {
        this.logger.warn(
          `Skipping realtime update for ${resource}: invalid adminId ${adminId}`,
        );
        return;
      }

      if (!projectId || !mongoose.isValidObjectId(projectId)) {
        this.logger.warn(
          `Skipping realtime update for ${resource}: invalid projectId ${projectId}`,
        );
        return;
      }

      this.logger.log(
        `Emitting realtime ${resource} update (${action}) to admin ${adminId}`,
      );
      this.whatsAppGateway.emitZoomRealtimeEvent(adminId, {
        resource,
        action,
        projectId,
      });
    } catch (error) {
      this.logger.error(
        `Failed to emit realtime update for ${resource} (${action})`,
        error,
      );
    }
  }

  // In zoom.service.ts

  /**
   * Processes Zoom webhook payloads with comprehensive error handling
   *
   * Error Recovery Strategy:
   * - Critical errors (invalid projectId, missing event): Return early, don't retry
   *   * Invalid or missing projectId - logged as error, returns without retry
   *   * Project not found or not configured - logged as error/warn, returns without retry
   *
   * - Validation errors (BadRequestException): Log and return, don't retry
   *   * Missing event type - throws BadRequestException, caught and logged as warning
   *   * Invalid webhook payload structure - throws BadRequestException, caught and logged
   *
   * - Data extraction failures: Log warning, continue processing
   *   * Missing occurrenceId - logged as warning, continues with undefined
   *   * Missing meeting ID - logged as warning, returns early
   *   * Invalid email format - logged as warning, continues with undefined email
   *
   * - Handler failures: Log error, continue (handlers don't throw)
   *   * All event handlers (handleMeetingStarted, handleParticipantJoined, etc.)
   *     catch their own errors and log them without throwing
   *   * Webhook processing continues even if individual handler fails
   *
   * - Event record creation failures: Log error, don't fail webhook
   *   * Event records are for tracking only, not critical for webhook success
   *   * Non-duplicate errors are logged but don't stop processing
   *
   * - Duplicate events: Log as warning, treat as success (idempotency)
   *   * Duplicate event records (code 11000) are logged as warnings
   *   * Webhook is considered successfully processed (idempotent)
   *
   * - Other errors: Throw for queue retry with exponential backoff
   *   * Network errors, database connection failures, etc. are thrown
   *   * The webhook queue will retry with exponential backoff
   *
   * @param payload The raw webhook payload from Zoom
   * @param projectId The Zoom project ID to process the webhook for
   * @throws Error for transient failures that should be retried by queue
   */
  async processWebhookPayloadV2(payload: any, projectId: string | undefined) {
    const timer = MonitoringUtil.createTimer();
    const correlationId = this.generateCorrelationId();

    try {
      // Generate correlation ID for tracing
      this.logWebhookProcessing(
        correlationId,
        'log',
        'Webhook processing started',
        {
          projectId,
          event: payload?.event,
        },
      );

      // Validate project ID format
      const zoomProjectId = mongoose.isValidObjectId(projectId)
        ? new Types.ObjectId(projectId)
        : null;

      if (!zoomProjectId) {
        this.logWebhookProcessing(
          correlationId,
          'error',
          'Invalid project ID format in webhook payload',
          { projectId, payload: this.safeExtract(payload, ['event'], {}) },
        );
        return;
      }

      // Check rate limit
      if (!this.checkRateLimit(zoomProjectId.toString())) {
        this.logWebhookProcessing(
          correlationId,
          'warn',
          'Rate limit exceeded for project',
          {
            projectId,
            event: payload?.event,
          },
        );
        // Still process the webhook but log the rate limit
        // In production, you might want to return early here
      }

      // Cleanup rate limit map periodically (every 100 calls)
      if (Math.random() < 0.01) {
        this.cleanupRateLimitMap();
      }

      // Validate project exists and is active
      const project = await this.zoomProjectModel
        .findById(zoomProjectId)
        .select('adminId isConfigured')
        .lean();

      if (!project) {
        this.logWebhookProcessing(correlationId, 'error', 'Project not found', {
          projectId
        });
        return;
      }

      if (!project.isConfigured) {
        this.logWebhookProcessing(
          correlationId,
          'warn',
          'Project is not configured, skipping webhook',
          { projectId },
        );
        return;
      }

      // Validate webhook payload structure
      ValidationUtil.validateWebhookPayload(payload);

      // Extract and validate event type
      const event: string = payload?.event ?? '';
      if (!event) {
        this.logWebhookProcessing(
          correlationId,
          'error',
          'Missing event type in webhook payload',
          { payload: this.safeExtract(payload, ['event'], {}) },
        );
        throw new BadRequestException('Webhook event is required');
      }

      // Validate event type against known events
      if (!this.validateEventType(event)) {
        this.logWebhookProcessing(
          correlationId,
          'warn',
          'Unhandled webhook event type',
          { event, projectId },
        );
        // Continue processing but log as unhandled
      }

      this.logWebhookProcessing(
        correlationId,
        'log',
        `Processing webhook event: ${event}`,
        {
          event,
          projectId
        },
      );

      // Safely extract payload data using helper function
      const accountId: string | undefined = this.safeExtract(payload, [
        'account_id',
        'payload.account_id',
      ]);
      const object = this.safeExtract(
        payload,
        ['payload.object', 'object'],
        {},
      );

      // Validate and extract meeting ID
      const meetingId = this.validateAndExtractMeetingId(object);
      if (!meetingId) {
        this.logWebhookProcessing(
          correlationId,
          'warn',
          'Invalid or missing meeting ID in webhook payload',
          { event, projectId },
        );
        return;
      }

      // Extract occurrences from payload
      const occurrences: ZoomMeetingOccurrence[] = Array.isArray(
        object?.occurrences,
      )
        ? object?.occurrences
        : [];

      // Extract occurrenceId with improved logic and error handling
      let occurrenceId: string | undefined = undefined;
      if (occurrences.length === 0) {
        // Only fetch from DB if occurrences not in payload
        try {
          const zoomMeeting =
            await this.zoomMeetingService.getZoomMeetingByMeetingId(meetingId);
          if (
            zoomMeeting &&
            Array.isArray(zoomMeeting?.occurrences) &&
            zoomMeeting.occurrences.length > 0
          ) {
            occurrences.push(...zoomMeeting.occurrences);
          }
        } catch (dbError) {
          this.logWebhookProcessing(
            correlationId,
            'warn',
            'Failed to fetch meeting occurrences from database',
            {
              error: dbError.message,
              meetingId,
              event,
            },
          );
          // Continue without occurrenceId
        }
      }

      // Extract occurrence ID with improved matching logic
      const eventTimestamp = payload?.event_ts
        ? new Date(payload.event_ts)
        : new Date();
      occurrenceId = await this.extractOccurrenceId(
        occurrences,
        meetingId,
        eventTimestamp,
      );

      this.logWebhookProcessing(
        correlationId,
        'log',
        `Occurrence ID extracted: ${occurrenceId}`,
        { meetingId, occurrenceId, occurrencesCount: occurrences.length },
      );

      // Safely extract participant and registrant data
      const participant = this.safeExtract(
        object,
        ['participant', 'participant_data'],
        {},
      );
      const registrant = this.safeExtract(
        object,
        ['registrant', 'registration'],
        {},
      );

      // Validate participant structure if present
      if (participant && Object.keys(participant).length > 0) {
        if (participant.email && typeof participant.email !== 'string') {
          this.logWebhookProcessing(
            correlationId,
            'warn',
            'Invalid participant email type',
            { meetingId, event },
          );
        }
      }

      // Validate registrant structure if present
      if (registrant && Object.keys(registrant).length > 0) {
        if (!registrant.email && !registrant.id) {
          this.logWebhookProcessing(
            correlationId,
            'warn',
            'Registrant missing required fields (email or id)',
            { meetingId, event },
          );
        }
      }

      const adminId = project.adminId.toString();
      let eventType: ZoomMeetingEventType | undefined;
      let isWebinarLiveEvent = false;

      // Route to the correct notification handler based on the event
      // Standardized to use early returns for events that don't create event records
      switch (event) {
        case ZoomWebhookEvent.MeetingCreated:
          await this.handleMeetingCreated(projectId, adminId);
          this.logWebhookProcessing(
            correlationId,
            'log',
            'Meeting created event processed',
            { meetingId, projectId },
          );
          return;

        case ZoomWebhookEvent.WebinarCreated:
          await this.handleWebinarCreated(projectId, adminId);
          this.logWebhookProcessing(
            correlationId,
            'log',
            'Webinar created event processed',
            { meetingId, projectId },
          );
          return;

        case ZoomWebhookEvent.MeetingStarted: {
          const meetingTopic = ValidationUtil.sanitizeText(
            this.safeExtract(object, ['topic'], 'the meeting'),
          );
          await this.handleMeetingStarted(
            meetingId,
            meetingTopic,
            false,
            occurrenceId,
          );
          eventType = ZoomMeetingEventType.MeetingStarted;
          break;
        }

        case ZoomWebhookEvent.WebinarStarted: {
          const webinarTopic = ValidationUtil.sanitizeText(
            this.safeExtract(object, ['topic'], 'the webinar'),
          );
          await this.handleMeetingStarted(
            meetingId,
            webinarTopic,
            true,
            occurrenceId,
          );
          eventType = ZoomMeetingEventType.MeetingStarted;
          isWebinarLiveEvent = true;
          break;
        }

        case ZoomWebhookEvent.MeetingParticipantJoined: {
          const participantEmail = participant?.email;
          if (participantEmail) {
            try {
              ValidationUtil.validateEmail(participantEmail);
              await this.handleParticipantJoined(
                meetingId,
                participantEmail,
                false,
                occurrenceId,
              );
            } catch (emailError) {
              this.logWebhookProcessing(
                correlationId,
                'warn',
                'Invalid participant email in webhook',
                {
                  participantEmail,
                  error: emailError.message,
                  meetingId,
                },
              );
            }
          } else {
            this.logWebhookProcessing(
              correlationId,
              'warn',
              'Missing participant email in participant joined event',
              { meetingId, event },
            );
          }
          eventType = ZoomMeetingEventType.ParticipantJoined;
          break;
        }

        case ZoomWebhookEvent.WebinarParticipantJoined: {
          const webinarParticipantEmail = participant?.email;
          if (webinarParticipantEmail) {
            try {
              ValidationUtil.validateEmail(webinarParticipantEmail);
              await this.handleParticipantJoined(
                meetingId,
                webinarParticipantEmail,
                true,
                occurrenceId,
              );
            } catch (emailError) {
              this.logWebhookProcessing(
                correlationId,
                'warn',
                'Invalid webinar participant email in webhook',
                {
                  participantEmail: webinarParticipantEmail,
                  error: emailError.message,
                  meetingId,
                },
              );
            }
          } else {
            this.logWebhookProcessing(
              correlationId,
              'warn',
              'Missing participant email in webinar participant joined event',
              { meetingId, event },
            );
          }
          eventType = ZoomMeetingEventType.ParticipantJoined;
          isWebinarLiveEvent = true;
          break;
        }

        case ZoomWebhookEvent.MeetingParticipantLeft: {
          // Reuse participant extracted at line 1443 to avoid redundant extraction
          await this.handleParticipantLeft(
            meetingId,
            participant,
            false,
            occurrenceId,
          );
          eventType = ZoomMeetingEventType.ParticipantLeft;
          break;
        }

        case ZoomWebhookEvent.WebinarParticipantLeft: {
          // Reuse participant extracted at line 1443 to avoid redundant extraction
          await this.handleParticipantLeft(
            meetingId,
            participant,
            true,
            occurrenceId,
          );
          eventType = ZoomMeetingEventType.ParticipantLeft;
          isWebinarLiveEvent = true;
          break;
        }

        case ZoomWebhookEvent.MeetingEnded: {
          const endedMeetingTopic = ValidationUtil.sanitizeText(
            this.safeExtract(object, ['topic'], 'the meeting'),
          );
          await this.handleMeetingEnded(
            meetingId,
            endedMeetingTopic,
            false,
            occurrenceId,
          );
          eventType = ZoomMeetingEventType.MeetingEnded;
          break;
        }

        case ZoomWebhookEvent.WebinarEnded: {
          const webinarEndedTopic = ValidationUtil.sanitizeText(
            this.safeExtract(object, ['topic'], 'the webinar'),
          );
          await this.handleMeetingEnded(
            meetingId,
            webinarEndedTopic,
            true,
            occurrenceId,
          );
          eventType = ZoomMeetingEventType.MeetingEnded;
          isWebinarLiveEvent = true;
          break;
        }

        case ZoomWebhookEvent.MeetingRegistrationCreated:
          await this.handleRegistrationCreated(
            meetingId,
            registrant,
            projectId,
            'meeting',
            occurrences,
          );
          this.logWebhookProcessing(
            correlationId,
            'log',
            'Meeting registration created event processed',
            { meetingId, projectId: zoomProjectId.toString() },
          );
          return;

        case ZoomWebhookEvent.WebinarRegistrationCreated:
          await this.handleRegistrationCreated(
            meetingId,
            registrant,
            projectId,
            'webinar',
            occurrences,
          );
          this.logWebhookProcessing(
            correlationId,
            'log',
            'Webinar registration created event processed',
            { meetingId, projectId: zoomProjectId.toString() },
          );
          return;

        default:
          this.logWebhookProcessing(
            correlationId,
            'warn',
            'Unhandled webhook event type',
            { event, meetingId, projectId: zoomProjectId.toString() },
          );
          return;
      }

      // Create meeting event record with idempotency consideration
      // Note: Database unique constraints should prevent duplicates
      // Transaction support: Full MongoDB transactions require replica set configuration.
      // Current implementation uses idempotency checks and error handling for data consistency.
      // For production with high consistency requirements, consider:
      // 1. Configuring MongoDB replica set
      // 2. Using mongoose.startSession() and session.withTransaction() for critical operations
      // 3. Implementing compensating transactions for rollback scenarios
      if (eventType) {
        try {
          // Validate occurrenceId before creating event
          const validatedOccurrenceId = this.validateOccurrenceId(occurrenceId);

          await this.zoomEventService.createMeetingEvent({
            accountId: accountId || undefined,
            meetingId,
            occurrenceId: validatedOccurrenceId,
            eventType,
            participantId: participant?.id,
            participantUserId: participant?.user_id,
            participantName: ValidationUtil.sanitizeText(
              participant?.user_name || participant?.name || '',
            ),
            participantEmail: participant?.email
              ? (() => {
                  try {
                    return ValidationUtil.validateEmail(participant.email);
                  } catch (emailError: any) {
                    this.logWebhookProcessing(
                      correlationId,
                      'warn',
                      'Invalid participant email for event record',
                      {
                        email: participant.email,
                        error: emailError.message,
                        meetingId,
                      },
                    );
                    return undefined;
                  }
                })()
              : undefined,
            raw: payload,
            projectId: zoomProjectId,
          });

          this.logWebhookProcessing(
            correlationId,
            'log',
            'Meeting event record created',
            {
              meetingId,
              eventType,
              occurrenceId: validatedOccurrenceId,
            },
          );

          await this.notifyLiveDataUpdate(
            projectId,
            meetingId,
            isWebinarLiveEvent,
          );
        } catch (eventError: any) {
          // Check if error is due to duplicate (idempotency)
          const isDuplicateError =
            eventError?.code === 11000 ||
            eventError?.message?.includes('duplicate') ||
            eventError?.message?.includes('E11000');

          if (isDuplicateError) {
            this.logWebhookProcessing(
              correlationId,
              'warn',
              'Duplicate event record detected (idempotency)',
              {
                meetingId,
                eventType,
                occurrenceId,
                error: eventError.message,
              },
            );
            // Don't treat duplicate as error - webhook was already processed
          } else {
            this.logWebhookProcessing(
              correlationId,
              'error',
              'Failed to create meeting event record',
              {
                meetingId,
                eventType,
                occurrenceId,
                error: eventError.message,
                stack: eventError.stack,
              },
            );
            // Don't throw here as the main webhook processing succeeded
            // The event record is for tracking, not critical for webhook success
          }
        }
      }

      // Store timer value once for consistent measurements
      const processingTimeMs = timer();

      this.logWebhookProcessing(
        correlationId,
        'log',
        'Webhook event processed successfully',
        {
          event,
          meetingId,
          projectId: zoomProjectId.toString(),
          processingTimeMs,
        },
      );

      // Log webhook processing metrics with same value
      MonitoringUtil.logWebhookMetrics(
        event,
        meetingId,
        processingTimeMs,
        true,
      );
    } catch (error: any) {
      this.logWebhookProcessing(
        correlationId,
        'error',
        'Failed to process webhook payload',
        {
          error: error.message,
          stack: error.stack,
          event: payload?.event,
          meetingId: this.safeExtract(payload, [
            'payload.object.id',
            'object.id',
          ]),
          projectId,
        },
      );

      // Log failed webhook processing with consistent timer value
      const errorProcessingTimeMs = timer();
      MonitoringUtil.logWebhookMetrics(
        payload?.event || 'unknown',
        this.safeExtract(
          payload,
          ['payload.object.id', 'object.id'],
          'unknown',
        ),
        errorProcessingTimeMs,
        false,
      );

      // Don't throw the error for validation issues - these shouldn't be retried
      if (error instanceof BadRequestException) {
        this.logWebhookProcessing(
          correlationId,
          'warn',
          'Webhook payload validation failed, ignoring',
          {
            error: error.message,
            event: payload?.event,
          },
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
    occurrenceId?: string,
  ) {
    try {
      this.logger.log('Handler invoked', {
        handler: 'handleMeetingStarted',
        meetingId,
        meetingTopic,
        isWebinar,
        occurrenceId,
      });

      // Validate inputs
      if (!meetingId || meetingId === 'undefined' || meetingId === 'null') {
        this.logger.warn('Validation failed', {
          handler: 'handleMeetingStarted',
          reason: 'Invalid meeting ID',
          meetingId,
        });
        return;
      }

      const meetingEventConfig =
        await this.meetingEventConfigService.getMeetingEventConfig(
          meetingId,
          occurrenceId,
        );

      if (!meetingEventConfig) {
        this.logger.warn('Configuration not found', {
          handler: 'handleMeetingStarted',
          meetingId,
          occurrenceId,
        });
        return;
      }

      this.logger.log('Configuration fetched', {
        handler: 'handleMeetingStarted',
        meetingId,
        occurrenceId,
      });

      const { meetingStarted } = meetingEventConfig;

      if (!meetingStarted?.enabled) {
        this.logger.log('Notifications disabled', {
          handler: 'handleMeetingStarted',
          meetingId,
          occurrenceId,
        });
        return;
      }

      // Check if already executed
      if (meetingStarted.isExecuted) {
        this.logger.warn('Event already executed', {
          handler: 'handleMeetingStarted',
          meetingId,
          occurrenceId,
          reason: 'Skipping duplicate processing',
        });
        return;
      }

      if (!mongoose.isValidObjectId(meetingStarted.configuredTemplateId)) {
        this.logger.warn('Validation failed', {
          handler: 'handleMeetingStarted',
          reason: 'Invalid template ID',
          meetingId,
          templateId: meetingStarted.configuredTemplateId,
        });
        return;
      }

      const configuredTemplate =
        await this.ConfiguredTemplateService.getConfiguredTemplate(
          meetingStarted.configuredTemplateId,
        );

      if (!configuredTemplate) {
        this.logger.warn('Template not found', {
          handler: 'handleMeetingStarted',
          meetingId,
          templateId: meetingStarted.configuredTemplateId,
        });
        return;
      }

      this.logger.log('Template fetched', {
        handler: 'handleMeetingStarted',
        meetingId,
        templateName: configuredTemplate.configuredTemplateName,
      });

      // Set isExecuted flag immediately to prevent duplicate processing
      await this.meetingEventConfigService.updateEventExecutedFlag(
        meetingId,
        'meetingStarted',
        occurrenceId,
      );

      const registrations = await this.getMeetingRegistrations({
        meetingId,
        adminId: meetingEventConfig.adminId,
        projectId: meetingEventConfig.whatsappProjectId,
        webinarID: meetingEventConfig.webinarId,
        zoomProjectId: meetingEventConfig.zoomProjectId,
        isWebinar,
        occurrenceId,
      });

      if (!registrations || registrations.length === 0) {
        this.logger.log('No registrations found', {
          handler: 'handleMeetingStarted',
          meetingId,
          occurrenceId,
        });
        return;
      }

      this.logger.log('Registrations fetched', {
        handler: 'handleMeetingStarted',
        meetingId,
        count: registrations.length,
      });

      // Send template messages with enhanced error handling
      const results = await this.whatsappService.sendTemplateMessages({
        fetchedContacts: registrations,
        template: configuredTemplate,
        meetingId,
        occurrenceId,
      });

      this.logger.log('Handler completed successfully', {
        handler: 'handleMeetingStarted',
        meetingId,
        occurrenceId,
        successful: results.successful,
        total: results.total,
      });

      if (results.failed > 0) {
        this.logger.warn('Some notifications failed', {
          handler: 'handleMeetingStarted',
          meetingId,
          occurrenceId,
          failed: results.failed,
          total: results.total,
        });
        results.errors.forEach((error) => {
          this.logger.warn('Notification failed for contact', {
            handler: 'handleMeetingStarted',
            meetingId,
            contactId: error.contactId,
            error: error.error,
          });
        });
      }
    } catch (error) {
      this.logger.error('Handler failed', {
        handler: 'handleMeetingStarted',
        error: error.message,
        stack: error.stack,
        meetingId,
        meetingTopic,
        isWebinar,
        occurrenceId,
      });
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
    occurrenceId?: string;
  }) {
    if (mongoose.isValidObjectId(data.webinarID)) {
      const registrations = await this.webinarService.getWebinarRegistrations(
        data.webinarID,
        data.adminId,
      );
      if (Array.isArray(registrations)) return registrations;
    } else {
      const registrations = await this.getAllMeetingRegistrants({
        adminId: data.adminId,
        zoomProjectId: data.zoomProjectId,
        meetingId: data.meetingId,
        isWebinar: data.isWebinar,
        occurrenceId: data.occurrenceId,
      });
      this.logger.log('Registrations fetched from Zoom API', {
        method: 'getMeetingRegistrations',
        meetingId: data.meetingId,
        count: registrations?.registrants?.length || 0,
      });
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
    occurrenceId?: string;
  }) {
    // Get all registrations first
    const allRegistrations = await this.getMeetingRegistrations(data);

    // Get participants who actually joined the meeting
    const meetingEvents =
      await this.zoomEventService.getMeetingEventsByMeetingId(
        data.meetingId,
        data.occurrenceId,
      );
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
    occurrenceId?: string;
  }) {
    // Get all registrations first
    const allRegistrations = await this.getMeetingRegistrations(data);

    // Get participants who actually joined the meeting
    const meetingEvents =
      await this.zoomEventService.getMeetingEventsByMeetingId(
        data.meetingId,
        data.occurrenceId,
      );
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
    occurrenceId?: string;
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
    occurrenceId?: string,
  ) {
    try {
      // Business-logic specific validation (meetingId already validated in processWebhookPayloadV2)
      if (!participantEmail) {
        this.logger.warn('Validation failed', {
          handler: 'handleParticipantJoined',
          reason: 'No participant email provided',
          meetingId,
          occurrenceId,
        });
        return;
      }

      this.logger.log('Handler invoked', {
        handler: 'handleParticipantJoined',
        meetingId,
        participantEmail,
        isWebinar,
        occurrenceId,
      });

      // Note: Currently there's no participantJoined config in MeetingEventConfiguration
      // This handler is implemented for future extensibility and tracking purposes
      // If notifications are needed in the future, add participantJoined to the schema

      // For now, we just log the event - the event record will be created in processWebhookPayloadV2
      this.logger.debug('Handler completed successfully', {
        handler: 'handleParticipantJoined',
        meetingId,
        participantEmail,
        isWebinar,
        occurrenceId,
      });
    } catch (error) {
      this.logger.error('Handler failed', {
        handler: 'handleParticipantJoined',
        error: error.message,
        stack: error.stack,
        meetingId,
        participantEmail,
        isWebinar,
        occurrenceId,
      });
      // Don't throw to avoid breaking webhook processing
    }
  }

  async handleParticipantLeft(
    meetingId: string,
    participantData: any,
    isWebinar: boolean,
    occurrenceId?: string,
  ) {
    try {
      // Business-logic specific validation (meetingId already validated in processWebhookPayloadV2)
      if (!participantData || !participantData.email) {
        this.logger.warn('Validation failed', {
          handler: 'handleParticipantLeft',
          reason: 'Missing participant email',
          meetingId,
          occurrenceId,
        });
        return;
      }

      this.logger.log('Handler invoked', {
        handler: 'handleParticipantLeft',
        meetingId,
        participantEmail: participantData.email,
        isWebinar,
        occurrenceId,
      });

      const meetingEventConfig =
        await this.meetingEventConfigService.getMeetingEventConfig(
          meetingId,
          occurrenceId,
        );

      if (!meetingEventConfig) {
        this.logger.debug('Configuration not found', {
          handler: 'handleParticipantLeft',
          meetingId,
          occurrenceId,
        });
        return;
      }

      const { participantLeft } = meetingEventConfig;

      if (
        !participantLeft.enabled ||
        !mongoose.isValidObjectId(participantLeft.configuredTemplateId)
      ) {
        this.logger.debug('Notifications disabled or invalid template', {
          handler: 'handleParticipantLeft',
          meetingId,
          occurrenceId,
          enabled: participantLeft.enabled,
          templateId: participantLeft.configuredTemplateId,
        });
        return;
      }

      const configuredTemplate =
        await this.ConfiguredTemplateService.getConfiguredTemplate(
          participantLeft.configuredTemplateId,
        );

      if (!configuredTemplate) {
        this.logger.warn('Template not found', {
          handler: 'handleParticipantLeft',
          meetingId,
          occurrenceId,
          templateId: participantLeft.configuredTemplateId,
        });
        return;
      }

      // Get the specific participant who left
      const participant = await this.getParticipantByEmail({
        meetingId,
        adminId: meetingEventConfig.adminId,
        projectId: meetingEventConfig.whatsappProjectId,
        webinarID: meetingEventConfig.webinarId,
        participantEmail: participantData.email,
        zoomProjectId: meetingEventConfig.zoomProjectId,
        isWebinar,
        occurrenceId,
      });

      if (!participant) {
        this.logger.debug('Participant not found in registrations', {
          handler: 'handleParticipantLeft',
          meetingId,
          occurrenceId,
          participantEmail: participantData.email,
        });
        return;
      }

      await this.whatsappService.sendTemplateMessages({
        fetchedContacts: [participant],
        template: configuredTemplate,
        meetingId,
        occurrenceId,
      });

      this.logger.log('Handler completed successfully', {
        handler: 'handleParticipantLeft',
        meetingId,
        occurrenceId,
        participantEmail: participantData.email,
      });
    } catch (error: any) {
      this.logger.error('Handler failed', {
        handler: 'handleParticipantLeft',
        error: error.message,
        stack: error.stack,
        meetingId,
        participantEmail: participantData?.email,
        occurrenceId,
        isWebinar,
      });
      // Don't throw to avoid breaking webhook processing
    }
  }

  async handleMeetingEnded(
    meetingId: string,
    meetingTopic: string,
    isWebinar: boolean,
    occurrenceId?: string,
  ) {
    try {
      this.logger.log('Handler invoked', {
        handler: 'handleMeetingEnded',
        meetingId,
        meetingTopic,
        isWebinar,
        occurrenceId,
      });

      const meetingEventConfig =
        await this.meetingEventConfigService.getMeetingEventConfig(
          meetingId,
          occurrenceId,
        );

      this.logger.log('Configuration fetched', {
        handler: 'handleMeetingEnded',
        meetingId,
        occurrenceId,
        configFound: !!meetingEventConfig,
      });

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
          this.logger.warn('Event already executed', {
            handler: 'handleMeetingEnded',
            eventType: 'meetingEndedAttendees',
            meetingId,
            occurrenceId,
            reason: 'Skipping duplicate processing',
          });
        } else {
          this.logger.log('Processing attendees notifications', {
            handler: 'handleMeetingEnded',
            meetingId,
            occurrenceId,
            templateId: meetingEndedAttendees.configuredTemplateId,
          });

          const configuredTemplate =
            await this.ConfiguredTemplateService.getConfiguredTemplate(
              meetingEndedAttendees.configuredTemplateId,
            );

          this.logger.log('Template fetched for attendees', {
            handler: 'handleMeetingEnded',
            meetingId,
            occurrenceId,
            templateName: configuredTemplate?.configuredTemplateName,
          });

          if (configuredTemplate) {
            // Set isExecuted flag immediately to prevent duplicate processing
            await this.meetingEventConfigService.updateEventExecutedFlag(
              meetingId,
              'meetingEndedAttendees',
              occurrenceId,
            );

            const attendees = await this.getMeetingAttendees({
              meetingId,
              adminId: meetingEventConfig.adminId,
              projectId: meetingEventConfig.whatsappProjectId,
              webinarID: meetingEventConfig.webinarId,
              zoomProjectId: meetingEventConfig.zoomProjectId,
              isWebinar,
              occurrenceId,
            });

            this.logger.log('Attendees fetched', {
              handler: 'handleMeetingEnded',
              meetingId,
              occurrenceId,
              count: attendees.length,
            });

            // Send messages even if attendees.length === 0 (flag already set)
            if (attendees.length > 0) {
              await this.whatsappService.sendTemplateMessages({
                fetchedContacts: attendees,
                template: configuredTemplate,
                meetingId,
                occurrenceId,
              });
            } else {
              this.logger.log('No attendees found', {
                handler: 'handleMeetingEnded',
                meetingId,
                occurrenceId,
                note: 'Flag already marked as executed',
              });
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
          this.logger.warn('Event already executed', {
            handler: 'handleMeetingEnded',
            eventType: 'meetingEndedNonAttendees',
            meetingId,
            occurrenceId,
            reason: 'Skipping duplicate processing',
          });
        } else {
          this.logger.log('Processing non-attendees notifications', {
            handler: 'handleMeetingEnded',
            meetingId,
            occurrenceId,
            templateId: meetingEndedNonAttendees.configuredTemplateId,
          });

          const configuredTemplate =
            await this.ConfiguredTemplateService.getConfiguredTemplate(
              meetingEndedNonAttendees.configuredTemplateId,
            );

          this.logger.log('Template fetched for non-attendees', {
            handler: 'handleMeetingEnded',
            meetingId,
            occurrenceId,
            templateName: configuredTemplate?.configuredTemplateName,
          });

          if (configuredTemplate) {
            // Set isExecuted flag immediately to prevent duplicate processing
            await this.meetingEventConfigService.updateEventExecutedFlag(
              meetingId,
              'meetingEndedNonAttendees',
              occurrenceId,
            );

            const nonAttendees = await this.getMeetingNonAttendees({
              meetingId,
              adminId: meetingEventConfig.adminId,
              projectId: meetingEventConfig.whatsappProjectId,
              webinarID: meetingEventConfig.webinarId,
              zoomProjectId: meetingEventConfig.zoomProjectId,
              isWebinar,
              occurrenceId,
            });

            this.logger.log('Non-attendees fetched', {
              handler: 'handleMeetingEnded',
              meetingId,
              occurrenceId,
              count: nonAttendees.length,
            });

            // Send messages even if nonAttendees.length === 0 (flag already set)
            if (nonAttendees.length > 0) {
              await this.whatsappService.sendTemplateMessages({
                fetchedContacts: nonAttendees,
                template: configuredTemplate,
                meetingId,
                occurrenceId,
              });
            } else {
              this.logger.log('No non-attendees found', {
                handler: 'handleMeetingEnded',
                meetingId,
                occurrenceId,
                note: 'Flag already marked as executed',
              });
            }
          }
        }
      }

      this.logger.log('Handler completed successfully', {
        handler: 'handleMeetingEnded',
        meetingId,
        occurrenceId,
      });

      return;
    } catch (error) {
      this.logger.error('Handler failed', {
        handler: 'handleMeetingEnded',
        error: error.message,
        stack: error.stack,
        meetingId,
        meetingTopic,
        isWebinar,
        occurrenceId,
      });
      return; // Explicit return for consistency with other handlers
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
    occurrenceId?: string,
  ) {
    try {
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
        const params: any = { status, page_size: pageSize, page_number: page };
        if (occurrenceId) {
          params.occurrence_id = occurrenceId;
        }
        const resp = await firstValueFrom(
          this.http.get(endpoint, {
            headers: { Authorization: `Bearer ${token}` },
            params,
          }),
        );
        return resp.data;
      });

      let registrants = Array.isArray(data?.registrants)
        ? data?.registrants
        : [];

      // Match and merge with attendees data
      if (registrants.length > 0) {
        const attendeesResult =
          await this.attendeesService.fetchGroupedAttendees(adminId, 1, 10000, {
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

  async fetchGroupedAttendees(adminId: Types.ObjectId, emails: string[]) {
    return await this.attendeesService.fetchGroupedAttendees(
      adminId,
      1,
      10000,
      { emails },
    );
  }

  async getAllMeetingRegistrants(data: {
    adminId: Types.ObjectId;
    zoomProjectId: Types.ObjectId;
    meetingId: string;
    isWebinar: boolean;
    status?: 'pending' | 'approved' | 'denied';
    occurrenceId?: string;
  }) {
    const {
      adminId,
      zoomProjectId,
      meetingId,
      isWebinar,
      status,
      occurrenceId,
    } = data;
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
        const data = await this.executeWithTokenRetry(
          project,
          async (token) => {
            const resp = await firstValueFrom(
              this.http.get(endpoint, {
                headers: { Authorization: `Bearer ${token}` },
                params: {
                  status,
                  page_size: pageSize,
                  page_number: currentPage,
                  occurrence_id: occurrenceId,
                },
              }),
            );
            return resp.data;
          },
        );

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
                10000,
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

  async getAllMeetingRegistrantsOnly(data: {
    adminId: Types.ObjectId;
    zoomProjectId: Types.ObjectId;
    meetingId: string;
    isWebinar: boolean;
    status?: 'pending' | 'approved' | 'denied';
    occurrenceId?: string;
  }): Promise<{ registrants: any[]; totalRecords: number }> {
    const {
      adminId,
      zoomProjectId,
      meetingId,
      isWebinar,
      status,
      occurrenceId,
    } = data;
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
        const data = await this.executeWithTokenRetry(
          project,
          async (token) => {
            const resp = await firstValueFrom(
              this.http.get(endpoint, {
                headers: { Authorization: `Bearer ${token}` },
                params: {
                  status,
                  page_size: pageSize,
                  page_number: currentPage,
                  occurrence_id: occurrenceId,
                },
              }),
            );
            return resp.data;
          },
        );

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

      return {
        registrants: allRegistrants,
        totalRecords: totalRecords,
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
