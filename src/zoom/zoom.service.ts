import { HttpService } from '@nestjs/axios';
import { Injectable, NotAcceptableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { firstValueFrom } from 'rxjs';
import { ZoomProject, ZoomProjectDocument } from './schemas/zoom-project.schema';

@Injectable()
export class ZoomService {
  constructor(
    private readonly http: HttpService,
    @InjectModel(ZoomProject.name) private readonly zoomProjectModel: Model<ZoomProjectDocument>,
    private readonly config: ConfigService,
  ) {}

  async exchangeCodeAndSave(
    code: string,
    adminId: Types.ObjectId,
    redirectUri: string,
  ) {
    if (!code || !adminId) {
      throw new NotAcceptableException('Code and admin are required');
    }

    const clientId = this.config.get<string>('ZOOM_CLIENT_ID');
    const clientSecret = this.config.get<string>('ZOOM_CLIENT_SECRET');
    const tokenEndpoint = 'https://zoom.us/oauth/token';

    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });

    const { data } = await firstValueFrom(
      this.http.post(tokenEndpoint, params.toString(), {
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }),
    );

    const expiresAt = new Date(Date.now() + (data.expires_in ?? 0) * 1000);

    const doc = await this.zoomProjectModel.findOneAndUpdate(
      { adminId, accountId: data.account_id },
      {
        adminId,
        accountId: data.account_id,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        accessTokenExpiresAt: expiresAt,
      },
      { upsert: true, new: true },
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

    const { data } = await firstValueFrom(
      this.http.get('https://api.zoom.us/v2/users/me', {
        headers: { Authorization: `Bearer ${doc.accessToken}` },
      }),
    );
    return data;
  }

  async processWebhookPayload(payload: any) {
    // Minimal logging; extend to verify Zoom signature and enqueue jobs
    try {
      console.log('[ZOOM WEBHOOK]', JSON.stringify(payload));
    } catch {
      console.log('[ZOOM WEBHOOK]', payload);
    }
    return true;
  }
}

