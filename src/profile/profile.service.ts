import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError, AxiosInstance } from 'axios';
import axios from 'axios';
import * as http from 'http';
import axiosRetry from 'axios-retry';
import { ProjectsService } from 'src/projects/projects.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  UpdateBusinessProfileDto,
  BusinessProfileResponseDto,
  DisplayNameStatusDto,
  DisplayNameStatus,
} from './dto/profile.dto';
import { WhatsappService } from 'src/whatsapp/whatsapp.service';
import { Profile, ProfileDocument } from './profile.schema';

@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);
  private readonly axiosInstance: AxiosInstance;

  constructor(
    private readonly configService: ConfigService,
    private readonly projectService: ProjectsService,
    private readonly whatsappService: WhatsappService,
    @InjectModel(Profile.name)
    private readonly profileModel: Model<ProfileDocument>,
  ) {
    // Initialize robust axios instance with IPv4 agent and retry logic
    const httpAgent = new http.Agent({ family: 4 });
    this.axiosInstance = axios.create({
      httpAgent: httpAgent,
    });

    // Apply automatic retry mechanism
    axiosRetry(this.axiosInstance, {
      retries: 3,
      retryDelay: (retryCount) => {
        this.logger.warn(`Request failed. Retrying in ${retryCount * 2}s... (Attempt ${retryCount})`);
        return retryCount * 2000;
      },
      retryCondition: (error) => {
        return axiosRetry.isNetworkOrIdempotentRequestError(error) || error.code === 'ETIMEDOUT';
      },
    });
  }

  private async fetchProfileFromMeta(account: any): Promise<BusinessProfileResponseDto> {
    const { permanentAccessToken, phoneNumberId } = account;
    const apiVersion = this.configService.get('GRAPH_API_VERSION') || 'v23.0';
    const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/whatsapp_business_profile`;

    const params = {
      fields: 'about,address,description,email,profile_picture_url,websites,vertical',
      access_token: permanentAccessToken,
    };

    this.logger.log(
      `Fetching business profile for phone number ${phoneNumberId}`,
    );

    const response = await this.axiosInstance.get(url, {
      params,
      timeout: 5000,
    });

    this.logger.log(
      `Successfully fetched business profile for phone number ${phoneNumberId}`,
    );

    return response.data?.data?.[0] || {};
  }

  private async upsertProfileCache(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    profile: BusinessProfileResponseDto,
  ) {
    const now = new Date();
    const update: Partial<ProfileDocument> = {
      about: profile.about,
      address: profile.address,
      description: profile.description,
      email: profile.email,
      websites: Array.isArray(profile.websites) ? profile.websites : [],
      vertical: profile.vertical,
      profile_picture_url: (profile as any).profile_picture_url,
      last_synced_at: now,
      raw: profile,
    };

    await this.profileModel.updateOne(
      { adminId, projectId },
      {
        $set: {
          adminId,
          projectId,
          ...update,
        },
      },
      { upsert: true },
    );

    return this.profileModel.findOne({ adminId, projectId }).lean();
  }

  async syncBusinessProfile(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
  ): Promise<{ data: BusinessProfileResponseDto | null }> {
    const account = await this.projectService.findOne(adminId, projectId);
    if (!account) {
      throw new UnauthorizedException(
        'You do not have permission to access this project.',
      );
    }

    if (!account.permanentAccessToken || !account.phoneNumberId) {
      throw new NotFoundException(
        'WhatsApp Business Account is not configured for this project. Please configure WhatsApp credentials first.',
      );
    }

    try {
      const profileFromMeta = await this.fetchProfileFromMeta(account);
      const cached = await this.upsertProfileCache(adminId, projectId, profileFromMeta);

      // Also sync display name status into cache
      try {
        const { permanentAccessToken, phoneNumberId } = account;
        const apiVersion = this.configService.get('GRAPH_API_VERSION') || 'v23.0';
        const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}`;

        const params = {
          fields:
            'name_status,display_phone_number, verified_name, quality_rating, throughput, messaging_limit_tier',
          access_token: permanentAccessToken,
        };

        const response = await this.axiosInstance.get(url, {
          params,
          timeout: 15000,
        });

        const displayNameStatus = this.mapNameStatus(response.data?.name_status || 'UNKNOWN');
        const displayPhoneNumber = response.data.display_phone_number || '';
        const verifiedName = response.data.verified_name || '';
        const qualityRating = response.data.quality_rating || '';
        const throughput = response.data?.throughput?.level || 'UNKNOWN';

        const now = new Date();
        await this.profileModel.updateOne(
          { adminId, projectId },
          {
            $set: {
              adminId,
              projectId,
              display_name_status: displayNameStatus,
              display_phone_number: displayPhoneNumber,
              verified_name: verifiedName,
              quality_rating: qualityRating,
              throughput,
              display_name_last_synced_at: now,
            },
          },
          { upsert: true },
        );
      } catch (err) {
        const axiosError = err as AxiosError;
        this.logger.error(
          `Failed to sync display name status for project ${projectId}`,
          {
            status: axiosError.response?.status,
            data: axiosError.response?.data,
            message: axiosError.message,
          },
        );
        // Do not fail the whole profile sync if display name sync fails
      }

      return { data: (cached as any) ?? null };
    } catch (error) {
      this.logger.error(
        `Failed to sync business profile for project ${projectId}`,
        (error as any)?.message || error,
      );
      throw error;
    }
  }

  private mapNameStatus(status: string): DisplayNameStatus {
    switch (status) {
      case 'APPROVED':
        return DisplayNameStatus.APPROVED;
      case 'PENDING_REVIEW':
        return DisplayNameStatus.PENDING;
      case 'DECLINED':
        return DisplayNameStatus.REJECTED;
      default:
        return DisplayNameStatus.UNKNOWN;
    }
  }

  /**
   * Get business profile information for a specific project
   */
  async getBusinessProfile(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
  ): Promise<BusinessProfileResponseDto> {
    const account = await this.projectService.findOne(adminId, projectId);
    if (!account) {
      throw new UnauthorizedException(
        'You do not have permission to access this project.',
      );
    }

    const cached = await this.profileModel
      .findOne({ adminId, projectId })
      .lean<BusinessProfileResponseDto & { profile_picture_url?: string }>();

    if (cached) {
      return {
        about: cached.about,
        address: cached.address,
        description: cached.description,
        email: cached.email,
        profile_picture_url: (cached as any).profile_picture_url,
        websites: cached.websites || [],
        vertical: cached.vertical,
      };
    }

    return {} as BusinessProfileResponseDto;
  }

  /**
   * Update business profile information
   */
  async updateBusinessProfile(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    updateProfileDto: UpdateBusinessProfileDto,
  ): Promise<{ success: boolean }> {
    const account = await this.projectService.findOne(adminId, projectId);
    if (!account) {
      throw new UnauthorizedException(
        'You do not have permission to access this project.',
      );
    }

    // Check if WhatsApp credentials are configured
    if (!account.permanentAccessToken || !account.phoneNumberId) {
      throw new NotFoundException(
        'WhatsApp Business Account is not configured for this project. Please configure WhatsApp credentials first.',
      );
    }

    const { permanentAccessToken, phoneNumberId } = account;
    const apiVersion = this.configService.get('GRAPH_API_VERSION') || 'v23.0';
    const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/whatsapp_business_profile`;

    // Build the Meta API payload
    const metaPayload: any = {
      messaging_product: 'whatsapp',
    };

    // Add optional fields if provided
    if (updateProfileDto.about !== undefined) {
      metaPayload.about = updateProfileDto.about;
    }
    if (updateProfileDto.address !== undefined) {
      metaPayload.address = updateProfileDto.address;
    }
    if (updateProfileDto.description !== undefined) {
      metaPayload.description = updateProfileDto.description;
    }
    if (updateProfileDto.email !== undefined) {
      metaPayload.email = updateProfileDto.email;
    }
    if (updateProfileDto.vertical !== undefined) {
      metaPayload.vertical = updateProfileDto.vertical;
    }
    if (updateProfileDto.websites !== undefined) {
      metaPayload.websites = updateProfileDto.websites;
    }
    if (updateProfileDto.profilePictureHandle !== undefined) {
      metaPayload.profile_picture_handle = updateProfileDto.profilePictureHandle;
    }

    this.logger.log(
      `Updating business profile for phone number ${phoneNumberId}: ${JSON.stringify(metaPayload, null, 2)}`,
    );

    try {
      const response = await this.axiosInstance.post(url, metaPayload, {
        headers: {
          Authorization: `Bearer ${permanentAccessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });

      this.logger.log(
        `Business profile updated successfully for phone number ${phoneNumberId}`,
      );

      try {
        const updatedProfile: BusinessProfileResponseDto = {
          about: updateProfileDto.about ?? undefined,
          address: updateProfileDto.address ?? undefined,
          description: updateProfileDto.description ?? undefined,
          email: updateProfileDto.email ?? undefined,
          websites: updateProfileDto.websites ?? [],
          vertical: updateProfileDto.vertical ?? undefined,
          profile_picture_url: undefined,
        };

        await this.upsertProfileCache(adminId, projectId, updatedProfile);
      } catch (cacheError) {
        this.logger.error(
          'Failed to update profile cache after profile update',
          (cacheError as any)?.message || cacheError,
        );
      }

      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.error(
        `Failed to update business profile for phone number ${phoneNumberId}`,
        {
          status: axiosError.response?.status,
          data: axiosError.response?.data,
          message: axiosError.message,
        },
      );

      // Provide more specific error messages
      if (axiosError.response?.status === 401) {
        throw new UnauthorizedException(
          'Invalid WhatsApp access token. Please reconfigure your WhatsApp Business Account.',
        );
      } else if (axiosError.response?.status === 403) {
        throw new UnauthorizedException(
          'Access denied. Please check your WhatsApp Business Account permissions.',
        );
      } else if (axiosError.response?.status === 400) {
        const errorMessage =
          axiosError.response?.data || 'Invalid profile data';
        throw new BadRequestException(
          `Profile update failed: ${errorMessage}`,
        );
      }

      throw new InternalServerErrorException(
        axiosError.response?.data || 'Could not update business profile.',
      );
    }
  }

  /**
   * Get display name status for a specific project
   */
  async getDisplayNameStatus(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
  ): Promise<DisplayNameStatusDto> {
    const account = await this.projectService.findOne(adminId, projectId);
    if (!account) {
      throw new UnauthorizedException(
        'You do not have permission to access this project.',
      );
    }

    // Check if WhatsApp credentials are configured
    if (!account.permanentAccessToken || !account.phoneNumberId) {
      throw new NotFoundException(
        'WhatsApp Business Account is not configured for this project. Please configure WhatsApp credentials first.',
      );
    }

    // Try cache first
    const cached = await this.profileModel.findOne({ adminId, projectId }).lean<ProfileDocument>();
    if (cached && cached.display_name_status) {
      return {
        displayNameStatus: this.mapNameStatus(cached.display_name_status),
        displayPhoneNumber: cached.display_phone_number || '',
        verifiedName: cached.verified_name || '',
        qualityRating: cached.quality_rating || '',
        throughput: cached.throughput || 'UNKNOWN',
      };
    }

    const { permanentAccessToken, phoneNumberId } = account;
    const apiVersion = this.configService.get('GRAPH_API_VERSION') || 'v23.0';
    const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}`;

    const params = {
      fields: 'name_status,display_phone_number, verified_name, quality_rating, throughput, messaging_limit_tier',
      access_token: permanentAccessToken,
    };

    this.logger.log(
      `Fetching display name status for phone number ${phoneNumberId}`,
    );

    try {
      const response = await this.axiosInstance.get(url, { 
        params,
        timeout: 15000,
      });


      this.logger.log(
        `Successfully fetched display name status for phone number ${phoneNumberId}`,
      );

      const displayNameStatus = this.mapNameStatus(response.data?.name_status || 'UNKNOWN');
      const displayPhoneNumber = response.data.display_phone_number || '';
      const verifiedName = response.data.verified_name || '';
      const qualityRating = response.data.quality_rating || '';
      const throughput = response.data?.throughput?.level || 'UNKNOWN';

      // Cache display name status in profile document
      const now = new Date();
      await this.profileModel.updateOne(
        { adminId, projectId },
        {
          $set: {
            
            adminId,
            projectId,
            display_name_status: displayNameStatus,
            display_phone_number: displayPhoneNumber,
            verified_name: verifiedName,
            quality_rating: qualityRating,
            throughput,
            display_name_last_synced_at: now,
          },
        },
        { upsert: true },
      );

      return {
        displayNameStatus,
        displayPhoneNumber: response.data.display_phone_number || '',
        verifiedName,
        qualityRating,
        throughput,
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.error(
        `Failed to fetch display name status for phone number ${phoneNumberId}`,
        {
          status: axiosError.response?.status,
          data: axiosError.response?.data,
          message: axiosError.message,
        },
      );

      // Provide more specific error messages
      if (axiosError.response?.status === 401) {
        throw new UnauthorizedException(
          'Invalid WhatsApp access token. Please reconfigure your WhatsApp Business Account.',
        );
      } else if (axiosError.response?.status === 403) {
        throw new UnauthorizedException(
          'Access denied. Please check your WhatsApp Business Account permissions.',
        );
      } else if (axiosError.response?.status === 404) {
        throw new NotFoundException(
          'WhatsApp Business Account not found. Please check your configuration.',
        );
      }

      throw new InternalServerErrorException(
        axiosError.response?.data || 'Could not fetch display name status from Meta.',
      );
    }
  }

  /**
   * Upload profile picture and get handle for profile update
   */
  async uploadProfilePicture(
    fileBuffer: Buffer,
    mimeType: string,
    originalName: string,
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
  ): Promise<string> {
    try {
      this.logger.log(`Uploading profile picture: ${originalName}`);

      const project = await this.projectService.findOne(adminId, projectId);
      if (!project) {
        throw new UnauthorizedException(
          'You do not have permission to access this project.',
        );
      }

      const apiVersion = this.configService.get('GRAPH_API_VERSION', 'v23.0');
      const accessToken = project.permanentAccessToken;
      const appId = project.appId;

      if (!accessToken || !appId) {
        throw new InternalServerErrorException(
          'WABA credentials are not configured.',
        );
      }

      // Step 1: Start an upload session
      const createSessionUrl = `https://graph.facebook.com/${apiVersion}/${appId}/uploads`;

      const sessionParams = {
        file_name: originalName,
        file_length: fileBuffer.length.toString(),
        file_type: mimeType,
        access_token: accessToken,
      };

      this.logger.log(
        `Creating upload session: ${originalName} (${fileBuffer.length} bytes, ${mimeType})`,
      );

      const sessionResponse = await this.axiosInstance.post(createSessionUrl, null, {
        params: sessionParams,
        timeout: 15000,
      });

      const uploadSessionId = sessionResponse.data.id;
      if (!uploadSessionId || !uploadSessionId.startsWith('upload:')) {
        throw new Error('Invalid upload session ID received from Meta');
      }

      // Step 2: Upload the file data
      const uploadUrl = `https://graph.facebook.com/${apiVersion}/${uploadSessionId}`;

      this.logger.log(`Uploading file data to session: ${uploadSessionId}`);

      const uploadResponse = await this.axiosInstance.post(uploadUrl, fileBuffer, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'file_offset': '0',
          'Content-Type': mimeType,
        },
        timeout: 15000,
      });

      const fileHandle = uploadResponse.data.h;
      if (!fileHandle) {
        throw new Error('No file handle received from Meta upload');
      }

      this.logger.log(`Profile picture uploaded successfully, handle: ${fileHandle}`);

      return fileHandle;

    } catch (error) {
      this.logger.error(
        'Profile picture upload failed:',
        JSON.stringify(error.response?.data),
      );
      this.logger.error(`Failed to upload profile picture: ${error.message}`);
      throw new InternalServerErrorException(
        `Failed to upload profile picture: ${error.response?.data?.error?.message || error.message}`,
      );
    }
  }

  /**
   * Check webhook subscription status for a specific project
   */
  async checkWebhookSubscription(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
  ): Promise<{ isSubscribed: boolean }> {
    const account = await this.projectService.findOne(adminId, projectId);
    if (!account) {
      throw new UnauthorizedException(
        'You do not have permission to access this project.',
      );
    }

    // Check if WhatsApp credentials are configured
    if (!account.permanentAccessToken || !account.wabaId) {
      throw new NotFoundException(
        'WhatsApp Business Account is not configured for this project. Please configure WhatsApp credentials first.',
      );
    }

    const { permanentAccessToken, wabaId } = account;

    const subscriptionStatus = await this.whatsappService.checkAppSubscriptionToWaba(
      wabaId,
      permanentAccessToken,
    );

    return {
      isSubscribed: subscriptionStatus.isSubscribed,
    };
  }

  /**
   * Subscribe webhook for a specific project
   */
  async subscribeWebhookForProject(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
  ): Promise<{ success: boolean }> {
    const account = await this.projectService.findOne(adminId, projectId);
    if (!account) {
      throw new UnauthorizedException(
        'You do not have permission to access this project.',
      );
    }

    // Check if WhatsApp credentials are configured
    if (!account.permanentAccessToken || !account.wabaId) {
      throw new NotFoundException(
        'WhatsApp Business Account is not configured for this project. Please configure WhatsApp credentials first.',
      );
    }

    const subscriptionResult = await this.whatsappService.subscribeAppToWabaForProject(
      adminId,
      projectId,
    );

    return {
      success: true,
    };
  }
}
