import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model, Types } from 'mongoose';
import {
  ApiCampaign,
  ApiCampaignDocument,
  MessageTemplate,
} from './api-campaign.schema';
import { CreateApiCampaignDto } from './dto/create-api-campaign.dto';
import { UpdateApiCampaignDto } from './dto/update-api-campaign.dto';
import { PaginatedApiCampaignsResponseDto } from './dto/paginated-api-campaigns-response.dto';
import { ExecuteApiCampaignDto } from './dto/execute-api-campaign.dto';
import { WhatsappService } from 'src/whatsapp/whatsapp.service';
import { WabaMessageType } from '../waba-message/waba-message.schema';
import { WabaMessageService } from '../waba-message/waba-message.service';

@Injectable()
export class ApiCampaignService {
  private readonly logger = new Logger(ApiCampaignService.name);

  constructor(
    @InjectModel(ApiCampaign.name)
    private apiCampaignModel: Model<ApiCampaignDocument>,
    private readonly whatsappService: WhatsappService,
    private readonly wabaMessageService: WabaMessageService,
  ) {}

  async create(
    createApiCampaignDto: CreateApiCampaignDto,
    adminId: string,
  ): Promise<ApiCampaign> {
    const { projectId, messageTemplate, ...rest } = createApiCampaignDto;
    const trimmedName = rest.name.trim();

    if (!trimmedName) {
      throw new BadRequestException('Campaign name cannot be empty');
    }

    const existingCampaign = await this.apiCampaignModel.exists({
      adminId: new Types.ObjectId(adminId),
      name: trimmedName,
      isDeleted: false,
    });

    if (existingCampaign) {
      throw new BadRequestException('Campaign name already exists');
    }

    const processedMessageTemplate: MessageTemplate = {
      ...messageTemplate,
      bodyVariables: messageTemplate.bodyVariables || [],
      headerMediaAssetId: mongoose.isValidObjectId(
        messageTemplate.headerMediaAssetId,
      )
        ? new Types.ObjectId(messageTemplate.headerMediaAssetId)
        : undefined,
    };

    const sampleJSON = await this.buildSampleExecutePayload(
      trimmedName,
      processedMessageTemplate,
    );

    console.log('sampleJSON', sampleJSON);

    const apiCampaign = new this.apiCampaignModel({
      ...rest,
      name: trimmedName,
      adminId: new Types.ObjectId(adminId),
      project: new Types.ObjectId(projectId),
      messageTemplate: processedMessageTemplate,
      sampleJSON,
    });

    return apiCampaign.save();
  }

  async findAll(
    adminId: string,
    projectId?: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedApiCampaignsResponseDto> {
    const filter: any = {
      adminId: new Types.ObjectId(adminId),
    };

    if (projectId) {
      filter.project = new Types.ObjectId(projectId);
    }

    // Calculate pagination
    const skip = (page - 1) * limit;
    const totalCount = await this.apiCampaignModel.countDocuments(filter);
    const totalPages = Math.ceil(totalCount / limit);

    // Get campaigns with pagination
    const campaigns = await this.apiCampaignModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .exec();

    return {
      campaigns,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    };
  }

  async findOne(id: string, adminId: string): Promise<any> {
    const apiCampaign = await this.apiCampaignModel
      .findOne({
        _id: new Types.ObjectId(id),
        adminId: new Types.ObjectId(adminId),
      })
      .exec();

    if (!apiCampaign) {
      throw new NotFoundException('apiCampaign not found');
    }

    // Calculate analytics at runtime from WABA messages
    const analyticsData = await this.calculateCampaignAnalytics(
      apiCampaign._id.toString(),
    );

    // Update campaign with real-time analytics
    apiCampaign.analyticsSummary = analyticsData;

    // Save the updated analytics to the database
    await this.updateAnalytics(apiCampaign._id.toString(), analyticsData);

    return apiCampaign;
  }

  async updateAnalytics(
    campaignId: string,
    analyticsData: any,
  ): Promise<ApiCampaign> {
    const apiCampaign = await this.apiCampaignModel
      .findByIdAndUpdate(
        campaignId,
        { $set: { analyticsSummary: analyticsData } },
        { new: true },
      )
      .exec();

    if (!apiCampaign) {
      throw new NotFoundException('apiCampaign not found');
    }

    return apiCampaign;
  }

  async update(
    id: string,
    updateApiCampaignDto: UpdateApiCampaignDto,
    adminId: string,
  ): Promise<ApiCampaign> {
    const updateData: any = { ...updateApiCampaignDto };

    if (typeof updateData.name === 'string') {
      const trimmedName = updateData.name.trim();

      if (!trimmedName) {
        throw new BadRequestException('Campaign name cannot be empty');
      }

      const duplicate = await this.apiCampaignModel.exists({
        _id: { $ne: new Types.ObjectId(id) },
        adminId: new Types.ObjectId(adminId),
        name: trimmedName,
        isDeleted: false,
      });

      if (duplicate) {
        throw new BadRequestException('Campaign name already exists');
      }

      updateData.name = trimmedName;
    }

    if (updateApiCampaignDto.projectId) {
      updateData.project = new Types.ObjectId(updateApiCampaignDto.projectId);
      delete updateData.projectId;
    }

    if (updateApiCampaignDto.messageTemplate) {
      const { headerMediaAssetId, ...restTemplate } =
        updateApiCampaignDto.messageTemplate;
      updateData.messageTemplate = {
        ...restTemplate,
        headerMediaAssetId:
          headerMediaAssetId && mongoose.isValidObjectId(headerMediaAssetId)
            ? new Types.ObjectId(headerMediaAssetId)
            : undefined,
      };
    }

    const existingCampaign = await this.apiCampaignModel
      .findOne({
        _id: new Types.ObjectId(id),
        adminId: new Types.ObjectId(adminId),
        isDeleted: false,
      })
      .exec();

    if (!existingCampaign) {
      throw new NotFoundException('ApiCampaign not found');
    }

    const nextName =
      typeof updateData.name === 'string'
        ? updateData.name
        : existingCampaign.name;

    const nextTemplate: MessageTemplate = updateData.messageTemplate
      ? updateData.messageTemplate
      : {
          templateName: existingCampaign.messageTemplate.templateName,
          bodyVariables: existingCampaign.messageTemplate.bodyVariables || [],
          headerMediaAssetId:
            existingCampaign.messageTemplate.headerMediaAssetId,
        };

    updateData.sampleJSON = await this.buildSampleExecutePayload(
      nextName,
      nextTemplate,
    );

    const apiCampaign = await this.apiCampaignModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          adminId: new Types.ObjectId(adminId),
          isDeleted: false,
        },
        updateData,
        { new: true },
      )
      .exec();

    if (!apiCampaign) {
      throw new NotFoundException('ApiCampaign not found');
    }

    return apiCampaign;
  }

  async remove(id: string, adminId: string): Promise<void> {
    const apiCampaign = await this.apiCampaignModel
      .findOne({
        _id: new Types.ObjectId(id),
        adminId: new Types.ObjectId(adminId),
        isDeleted: false,
      })
      .exec();

    if (!apiCampaign) {
      throw new NotFoundException('ApiCampaign not found');
    }

    await this.apiCampaignModel
      .updateOne(
        {
          _id: new Types.ObjectId(id),
          adminId: new Types.ObjectId(adminId),
          isDeleted: false,
        },
        { isDeleted: true },
      )
      .exec();
  }

  async execute(
    executeApiCampaignDto: ExecuteApiCampaignDto,
    adminId: string,
  ): Promise<any> {
    const { campaignName, destination, media, templateParams } =
      executeApiCampaignDto;

    const apiCampaign = await this.apiCampaignModel.findOne({
      name: campaignName,
      adminId: new Types.ObjectId(adminId),
      isDeleted: false,
    });
    if (!apiCampaign) {
      throw new NotFoundException('ApiCampaign not found or Deleted.');
    }
    const template = apiCampaign.messageTemplate;

    await this.whatsappService.sendSingleTemplateMessage({
      adminId: new Types.ObjectId(adminId),
      projectId: apiCampaign.project.toString(),
      recipientPhoneNumber: destination,
      templateName: template.templateName,
      bodyVariables: templateParams || [],
      messageType: WabaMessageType.API_CAMPAIGN,
      apiCampaignId: apiCampaign._id.toString(),
      media
    });

    return {
      message: 'Campaign execution logged',
      campaignName,
      destination,
      media,
      templateParams: templateParams || [],
    };
  }

  async getApiCampaignReportForDownload(
    campaignId: string,
    adminId: string,
  ): Promise<any> {
    const apiCampaign = await this.findOne(campaignId, adminId);
    const messages =
      await this.wabaMessageService.getApiCampaignMessages(campaignId);
    const messageStats = await this.wabaMessageService.getMessageStats({
      apiCampaignId: new Types.ObjectId(campaignId),
    });

    const formattedMessages = messages.map((msg) => ({
      phoneNumber: msg.phoneNumber,
      templateName: msg.templateName,
      messageType: msg.messageType,
      status: msg.status,
      createdAt: msg.createdAt,
      sentAt: msg.sentAt || '',
      deliveredAt: msg.deliveredAt || '',
      readAt: msg.readAt || '',
      failureReason: msg.failureReason || '',
      wabaMessageId: msg.wabaMessageId,
    }));

    return {
      campaign: {
        id: apiCampaign._id,
        name: apiCampaign.name,
        status: apiCampaign.status,
        createdAt: apiCampaign.createdAt,
        updatedAt: apiCampaign.updatedAt,
      },
      messages: formattedMessages,
      statistics: messageStats,
      totalMessages: messages.length,
    };
  }

  private async buildSampleExecutePayload(
    campaignName: string,
    template: MessageTemplate,
  ) {
    const templateParams =
      template.bodyVariables && template.bodyVariables.length > 0
        ? [...template.bodyVariables]
        : [];

    let mediaUrl = '';
    let mediaFileName = '';

    if (template.headerMediaAssetId) {
      const mediaInfo = await this.whatsappService.getMediaAssetInfo(
        template.headerMediaAssetId,
      );
      if (mediaInfo) {
        mediaUrl = mediaInfo.filePath;
        mediaFileName = mediaInfo.fileName;
      }
    }

    return {
      campaignName,
      destination: '<recipient_phone_number>',
      ...(template.headerMediaAssetId
        ? {
            media: {
              url: '<media_url>',
              filename: '<media_filename>',
            },
          }
        : {}),
      ...(templateParams.length > 0
        ? {
            templateParams,
          }
        : {}),
    };
  }

  private async calculateCampaignAnalytics(
    apiCampaignId: string,
  ): Promise<any> {
    try {
      // Get message statistics from WABA messages
      const messageStats = await this.wabaMessageService.getMessageStats({
        apiCampaignId: new Types.ObjectId(apiCampaignId),
      });

      // Calculate analytics based on message statuses
      const analyticsData = {
        total: messageStats.total || 0,
        sent: messageStats.sent || 0,
        delivered: messageStats.delivered || 0,
        read: messageStats.read || 0,
        clicked: messageStats.clicked || 0,
        failed: messageStats.failed || 0,
      };

      this.logger.log(
        `Calculated analytics for campaign ${apiCampaignId}:`,
        analyticsData,
      );
      return analyticsData;
    } catch (error) {
      this.logger.error(
        `Failed to calculate campaign analytics for ${apiCampaignId}`,
        error,
      );

      // Return default analytics if calculation fails
      return {
        total: 0,
        sent: 0,
        delivered: 0,
        read: 0,
        clicked: 0,
        failed: 0,
      };
    }
  }
}
