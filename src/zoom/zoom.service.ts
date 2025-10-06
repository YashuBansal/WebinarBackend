import { HttpService } from '@nestjs/axios';
import { Injectable, NotAcceptableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { firstValueFrom } from 'rxjs';
import { ZoomProject, ZoomProjectDocument } from './schemas/zoom-project.schema';
import { ZoomMeetingEvent, ZoomMeetingEventDocument, ZoomMeetingEventType } from './schemas/zoom-meeting-event.schema';
import { ZoomWebhookEvent } from './enums/zoom-webhook-event.enum';
import * as crypto from 'crypto';

@Injectable()
export class ZoomService {
  constructor(
    private readonly http: HttpService,
    @InjectModel(ZoomProject.name) private readonly zoomProjectModel: Model<ZoomProjectDocument>,
    @InjectModel(ZoomMeetingEvent.name) private readonly zoomMeetingEventModel: Model<ZoomMeetingEventDocument>,
    private readonly config: ConfigService,
  ) {}

  // ====== Access Token Utilities ======
  private async refreshAccessTokenForProject(project: ZoomProjectDocument) {
    const tokenEndpoint = 'https://zoom.us/oauth/token';

    // Path 1: If we have a refresh token (Authorization Code flow), use it
    if (project?.refreshToken) {
      const clientId = this.config.get<string>('ZOOM_CLIENT_ID');
      const clientSecret = this.config.get<string>('ZOOM_CLIENT_SECRET');
      const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: project.refreshToken,
      });

      const { data } = await firstValueFrom(
        this.http.post(tokenEndpoint, params.toString(), {
          headers: {
            'Authorization': `Basic ${authHeader}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }),
      );

      project.accessToken = data.access_token;
      project.refreshToken = data.refresh_token ?? project.refreshToken;
      project.accessTokenExpiresAt = new Date(Date.now() + (data.expires_in ?? 0) * 1000);
      await project.save();
      return project;
    }

    // Path 2: Server-to-Server OAuth (account_credentials) does NOT return refresh_token.
    // Re-acquire an access token using stored clientId/clientSecret/accountId.
    if (project?.clientId && project?.clientSecret && project?.accountId) {
      const authHeader = Buffer.from(`${project.clientId}:${project.clientSecret}`).toString('base64');
      const params = new URLSearchParams({
        grant_type: 'account_credentials',
        account_id: project.accountId,
      });

      const { data } = await firstValueFrom(
        this.http.post(tokenEndpoint, params.toString(), {
          headers: {
            'Authorization': `Basic ${authHeader}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }),
      );

      project.accessToken = data.access_token;
      // No refresh token expected here
      project.accessTokenExpiresAt = new Date(Date.now() + (data.expires_in ?? 0) * 1000);
      await project.save();
      return project;
    }

    throw new NotAcceptableException('No method available to refresh Zoom access token');
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

  private async executeWithTokenRetry<T>(project: ZoomProjectDocument, fn: (token: string) => Promise<T>): Promise<T> {
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
      const isInvalidGrant = status === 400 && (err?.error === 'invalid_grant' || err?.error === 'invalid_token' || /invalid token/i.test(err?.reason || ''));
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

    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
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
            'Authorization': `Basic ${authHeader}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }),
      );
      data = response.data;
      console.log(data);
    } catch (error: any) {
      const status = error?.response?.status;
      const payload = error?.response?.data ?? error?.message ?? 'Unknown error';
      // Log full error for diagnostics
      console.error('Zoom token exchange failed:', { status, payload });
      throw new NotAcceptableException('Failed to exchange authorization code with Zoom');
    }

    const expiresAt = new Date(Date.now() + (data.expires_in ?? 0) * 1000);

    // Get user profile to extract account_id
    let accountId: string;
    try {
      const profileResponse = await firstValueFrom(
        this.http.get('https://api.zoom.us/v2/users/me', {
          headers: {
            'Authorization': `Bearer ${data.access_token}`,
          },
        }),
      );
      accountId = profileResponse.data.account_id;
      console.log('Retrieved account ID:', accountId);
    } catch (error: any) {
      console.error('Failed to get user profile:', error?.response?.data || error?.message);
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
    if (!doc?.refreshToken) throw new NotAcceptableException('No refresh token found');

    const clientId = this.config.get<string>('ZOOM_CLIENT_ID');
    const clientSecret = this.config.get<string>('ZOOM_CLIENT_SECRET');
    const tokenEndpoint = 'https://zoom.us/oauth/token';
    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: doc.refreshToken,
    });

    const { data } = await firstValueFrom(
      this.http.post(tokenEndpoint, params.toString(), {
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }),
    );

    doc.accessToken = data.access_token;
    doc.refreshToken = data.refresh_token ?? doc.refreshToken;
    doc.accessTokenExpiresAt = new Date(Date.now() + (data.expires_in ?? 0) * 1000);
    await doc.save();
    return { accountId: doc.accountId, accessTokenExpiresAt: doc.accessTokenExpiresAt };
  }

  async getZoomUserProfile(adminId: Types.ObjectId, accountId: string) {
    const doc = await this.zoomProjectModel.findOne({ adminId, accountId });
    if (!doc?.accessToken) throw new NotAcceptableException('No access token found');
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
      const payload = error?.response?.data ?? error?.message ?? 'Unknown error';
      console.error('Zoom user profile failed:', { status, payload });
      throw new NotAcceptableException('Failed to fetch Zoom profile');
    }
  }

  async getProjectMeetings(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    type: 'scheduled' | 'upcoming' | 'live' | 'past' | 'pending' = 'upcoming',
    pageSize: number = 30,
  ) {
    const project = await this.zoomProjectModel.findOne({ _id: projectId, adminId });
    if (!project?.accessToken) throw new NotAcceptableException('No access token found');

    let data: any;
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
      console.log(" )))))))) < ", data);
    } catch (error: any) {
      const status = error?.response?.status;
      const payload = error?.response?.data ?? error?.message ?? 'Unknown error';
      console.error('Zoom list meetings failed:', { status, payload });
      throw new NotAcceptableException('Failed to fetch meetings from Zoom');
    }

    // Return a light-weight shape expected by frontend
    return {
      totalRecords: data?.total_records ?? 0,
      meetings: (data?.meetings ?? []).map((m: any) => ({
        id: String(m.id ?? m.uuid ?? ''),
        uuid: m.uuid,
        topic: m.topic,
        startTime: m.start_time,
        duration: m.duration,
        status: m.status,
        joinUrl: m.join_url,
        createdAt: m.created_at,
      })),
    };
  }

  async validateWebhook(payload: any, projectId: Types.ObjectId) {
    const { plainToken } = payload.payload;

    if (!plainToken) {
      // Or handle the error as you see fit
      throw new Error('plainToken is missing in the validation payload.');
    }

    const secretToken = await this.zoomProjectModel.findOne({ _id: projectId }).select('secretToken');
    console.log('secretToken', secretToken, projectId, plainToken);
    if (!secretToken || !secretToken.secretToken) {
      throw new Error('Zoom webhook secret token is not configured.');
    }



    const hash = crypto.createHmac('sha256', secretToken.secretToken) 
      .update(plainToken)
      .digest('hex');

    const response = {
      plainToken: plainToken,
      encryptedToken: hash
    };

    console.log('response', response);

    return response;
  }

  async processWebhookPayload(payload: any) {
    // TODO: verify Zoom signature for production
    console.log('processWebhookPayload', payload);
    const event: string = payload?.event ?? '';
    const accountId: string | undefined = payload?.account_id || payload?.payload?.account_id;
    const object = payload?.payload?.object || payload?.object || {};
    const meetingId: string | undefined = String(object?.id || object?.uuid || '');
    const participant = object?.participant || object?.participant_data || {};

    let eventType: ZoomMeetingEventType | undefined;
    if (event === ZoomWebhookEvent.MeetingParticipantJoined) eventType = ZoomMeetingEventType.ParticipantJoined;
    if (event === ZoomWebhookEvent.MeetingParticipantLeft) eventType = ZoomMeetingEventType.ParticipantLeft;
    console.log('eventType', eventType, meetingId);
    if (!eventType || !meetingId) {
      return true;
    }

    await this.zoomMeetingEventModel.create({
      accountId,
      meetingId,
      eventType,
      participantId: participant?.id,
      participantUserId: participant?.user_id,
      participantName: participant?.user_name || participant?.name,
      participantEmail: participant?.email,
      raw: payload,
    });

    return true;
  }
  

  async getMeetingDetails(adminId: Types.ObjectId, projectId: Types.ObjectId, meetingId: string) {
    const project = await this.zoomProjectModel.findOne({ _id: projectId, adminId });
    if (!project?.accessToken) throw new NotAcceptableException('No access token found');

    try {
      const data = await this.executeWithTokenRetry(project, async (token) => {
        const resp = await firstValueFrom(
          this.http.get(`https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        );
        return resp.data;
      });
      return data;
    } catch (error: any) {
      const status = error?.response?.status;
      const payload = error?.response?.data ?? error?.message ?? 'Unknown error';
      console.error('Zoom meeting details failed:', { status, payload });
      throw new NotAcceptableException('Failed to fetch meeting details from Zoom');
    }
  }

  async getMeetingRegistrants(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    meetingId: string,
    status: 'pending' | 'approved' | 'denied' = 'approved',
  ) {
    const project = await this.zoomProjectModel.findOne({ _id: projectId, adminId });
    if (!project?.accessToken) throw new NotAcceptableException('No access token found');

    try {
      const data = await this.executeWithTokenRetry(project, async (token) => {
        const resp = await firstValueFrom(
          this.http.get(`https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}/registrants`, {
            headers: { Authorization: `Bearer ${token}` },
            params: { status },
          }),
        );
        return resp.data;
      });
      return data;
    } catch (error: any) {
      const status = error?.response?.status;
      const payload = error?.response?.data ?? error?.message ?? 'Unknown error';
      console.error('Zoom registrants fetch failed:', { status, payload });
      throw new NotAcceptableException('Failed to fetch meeting registrants from Zoom');
    }
  }

  async addMeetingRegistrant(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    meetingId: string,
    body: { email: string; first_name?: string; last_name?: string },
  ) {
    const project = await this.zoomProjectModel.findOne({ _id: projectId, adminId });
    if (!project?.accessToken) throw new NotAcceptableException('No access token found');

    try {
      const data = await this.executeWithTokenRetry(project, async (token) => {
        const resp = await firstValueFrom(
          this.http.post(`https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}/registrants`, body, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        );
        return resp.data;
      });
      return data;
    } catch (error: any) {
      const status = error?.response?.status;
      const payload = error?.response?.data ?? error?.message ?? 'Unknown error';
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
    const tokenEndpoint = 'https://zoom.us/oauth/token';
    const authHeader = Buffer.from(`${payload.clientId}:${payload.clientSecret}`).toString('base64');
    const params = new URLSearchParams({
      grant_type: 'account_credentials',
      account_id: payload.accountId,
    });

    let tokenData: any;
    try {
      const response = await firstValueFrom(
        this.http.post(tokenEndpoint, params.toString(), {
          headers: {
            'Authorization': `Basic ${authHeader}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }),
      );
      tokenData = response.data;
    } catch (error: any) {
      const status = error?.response?.status;
      const payload = error?.response?.data ?? error?.message ?? 'Unknown error';
      console.error('Zoom credential validation failed:', { status, payload });
      throw new NotAcceptableException('Invalid Zoom credentials or account');
    }

    const expiresAt = new Date(Date.now() + (tokenData.expires_in ?? 0) * 1000);
    console.log('tokenData', tokenData);

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

  async bulkDeleteProjects(adminId: Types.ObjectId, projectIds: Types.ObjectId[]) {
    const result = await this.zoomProjectModel.deleteMany({
      _id: { $in: projectIds },
      adminId,
    });

    return result.deletedCount;
  }

  async getProjectConfigurationStatus(adminId: Types.ObjectId, projectId: Types.ObjectId) {
    const project = await this.zoomProjectModel.findOne({ _id: projectId, adminId });
    
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
      }
    };
  }
}

