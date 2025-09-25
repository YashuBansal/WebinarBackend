import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model, Types } from 'mongoose';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import {
  Campaign,
  CampaignDocument,
} from '../../schemas/whatsapp-embed/campaign.schema';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { ExecuteCampaignDto } from './dto/execute-campaign.dto';
import { CreateCampaignWorkflowDto } from './dto/create-campaign-workflow.dto';
import { PaginatedCampaignsResponseDto } from './dto/paginated-campaigns-response.dto';
import { WabaMessageService } from '../waba-message/waba-message.service';
import { ProjectsService } from '../../projects/projects.service';

@Injectable()
export class CampaignService {
  private readonly logger = new Logger(CampaignService.name);

  constructor(
    @InjectModel(Campaign.name) private campaignModel: Model<CampaignDocument>,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly wabaMessageService: WabaMessageService,
    private readonly projectService: ProjectsService,
  ) {}

  async create(
    createCampaignDto: CreateCampaignDto,
    adminId: string,
  ): Promise<Campaign> {
    const campaign = new this.campaignModel({
      ...createCampaignDto,
      adminId: new Types.ObjectId(adminId),
      project: new Types.ObjectId(createCampaignDto.projectId),
    });

    return campaign.save();
  }

  /**
   * Create campaign through multi-step workflow
   */
  async createCampaignWorkflow(
    createCampaignWorkflowDto: CreateCampaignWorkflowDto,
    adminId: string,
  ): Promise<any> {
    const {
      name,
      projectId,
      selectedContacts,
      templateName,
      variableMappings,
      sendType,
      scheduledAt,
      headerMediaAssetId,
    } = createCampaignWorkflowDto;

    // Create the campaign
    const campaign = new this.campaignModel({
      name,
      adminId: new Types.ObjectId(adminId),
      project: new Types.ObjectId(projectId),
      messageTemplate: {
        templateName,
        body: 'BODY',
      },
      status: sendType === 'now' ? 'draft' : 'draft',
      scheduledAt:
        sendType === 'scheduled' && scheduledAt
          ? new Date(scheduledAt)
          : undefined,
      headerMediaAssetId: headerMediaAssetId || undefined,
      storedCampaignData: sendType === 'scheduled' ? {
        contacts: selectedContacts,
        bodyVariables: variableMappings?.map((mapping) => mapping.contactField) || [],
        language: 'en_US',
        variableMappings: variableMappings || [],
        headerMediaAssetId: headerMediaAssetId || undefined,
      } : undefined,
    });

    const savedCampaign = await campaign.save();

    // If sendType is 'now', execute the campaign immediately
    if (sendType === 'now') {
      try {
        const executionResult = await this.executeCampaign(
          {
            campaignId: savedCampaign._id.toString(),
            contacts: selectedContacts,
            bodyVariables:
              variableMappings?.map((mapping) => mapping.contactField) || [],
            language: 'en_US',
          },
          adminId,
        );

        return {
          campaign: savedCampaign,
          executionResult,
          sampleMessage: this.generateSampleMessage(
            'BODY',
            variableMappings,
            selectedContacts[0],
          ),
          totalRecipients: selectedContacts.length,
        };
      } catch (error) {
        this.logger.error('Failed to execute campaign immediately:', error);
        // Return campaign even if execution fails
        return {
          campaign: savedCampaign,
          executionResult: null,
          sampleMessage: this.generateSampleMessage(
            'BODY',
            variableMappings,
            selectedContacts[0],
          ),
          totalRecipients: selectedContacts.length,
        };
      }
    }

    // For scheduled campaigns, return campaign details
    return {
      campaign: savedCampaign,
      executionResult: null,
      sampleMessage: this.generateSampleMessage(
        'BODY',
        variableMappings,
        selectedContacts[0],
      ),
      totalRecipients: selectedContacts.length,
    };
  }

  /**
   * Generate sample message for preview
   */
  private generateSampleMessage(
    templateBody: string,
    variableMappings: any[],
    sampleContact: any,
  ): string {
    if (!variableMappings || variableMappings.length === 0) {
      return templateBody;
    }

    let message = templateBody;
    variableMappings.forEach((mapping) => {
      const placeholder = mapping.variable;
      const contactField = mapping.contactField;
      const value = sampleContact[contactField] || placeholder;
      message = message.replace(
        new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'),
        value,
      );
    });

    return message;
  }

  async findAll(
    adminId: string,
    projectId?: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedCampaignsResponseDto> {
    const filter: any = {
      adminId: new Types.ObjectId(adminId),
      isDeleted: false,
    };

    if (projectId) {
      filter.project = new Types.ObjectId(projectId);
    }

    // Calculate pagination
    const skip = (page - 1) * limit;
    const totalCount = await this.campaignModel.countDocuments(filter);
    const totalPages = Math.ceil(totalCount / limit);

    // Get campaigns with pagination
    const campaigns = await this.campaignModel
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

  async findOne(id: string, adminId: string): Promise<Campaign> {
    console.log(id, adminId, mongoose.Types.ObjectId.isValid(id), mongoose.Types.ObjectId.isValid(adminId));
    const campaign = await this.campaignModel
      .findOne({
        _id: new Types.ObjectId(id),
        adminId: new Types.ObjectId(adminId),
        isDeleted: false,
      })
      .populate('project', 'name')
      .populate('adminId', 'firstName lastName email')
      .exec();

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    return campaign;
  }

  async update(
    id: string,
    updateCampaignDto: UpdateCampaignDto,
    adminId: string,
  ): Promise<Campaign> {
    const updateData: any = { ...updateCampaignDto };

    if (updateCampaignDto.projectId) {
      updateData.project = new Types.ObjectId(updateCampaignDto.projectId);
    }

    if (updateCampaignDto.status === 'completed') {
      updateData.completedAt = new Date();
    }

    const campaign = await this.campaignModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          adminId: new Types.ObjectId(adminId),
          isDeleted: false,
        },
        updateData,
        { new: true },
      )
      .populate('project', 'name')
      .populate('adminId', 'firstName lastName email')
      .exec();

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    return campaign;
  }

  async remove(id: string, adminId: string): Promise<void> {
    const result = await this.campaignModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          adminId: new Types.ObjectId(adminId),
          isDeleted: false,
        },
        { isDeleted: true },
      )
      .exec();

    if (!result) {
      throw new NotFoundException('Campaign not found');
    }
  }

  async updateAnalytics(
    campaignId: string,
    analyticsData: any,
  ): Promise<Campaign> {
    console.log('updating --------------- > analyticsData', analyticsData);
    const campaign = await this.campaignModel
      .findByIdAndUpdate(
        campaignId,
        { $set: { analyticsSummary: analyticsData } },
        { new: true },
      )
      .exec();

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    return campaign;
  }

  async getCampaignAnalytics(
    campaignId: string,
    adminId: string,
  ): Promise<any> {
    const campaign = await this.findOne(campaignId, adminId);
    return campaign.analyticsSummary;
  }

  async getScheduledCampaigns(): Promise<Campaign[]> {
    const now = new Date();
    return this.campaignModel
      .find({
        status: 'draft',
        scheduledAt: { $lte: now },
        isDeleted: false,
      })
      .populate('project', 'name')
      .exec();
  }

  /**
   * Execute a campaign by sending messages to all contacts
   * Similar to WhatsApp service's sendBulkTemplateMessage method
   */
  async executeCampaign(
    executeCampaignDto: ExecuteCampaignDto,
    adminId: string,
  ): Promise<any> {
    const { campaignId, contacts, bodyVariables, language, headerMediaAssetId } =
      executeCampaignDto;
    console.log(executeCampaignDto);

    this.logger.log(
      `Executing campaign ${campaignId} for ${contacts.length} contacts`,
    );

    // Get campaign details
    const campaign = await this.findOne(campaignId, adminId);
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    if (campaign.status !== 'draft') {
      throw new BadRequestException(
        'Campaign can only be executed when in draft status');
    }

    // Get project details for WhatsApp credentials
    const project = await this.projectService.findOne(
      new Types.ObjectId(adminId),
      campaign.project,
    );

    if (!project) {
      throw new UnauthorizedException(
        'You do not have permission to access this project',
      );
    }

    // Check if WhatsApp credentials are configured
    if (!project.permanentAccessToken || !project.phoneNumberId) {
      throw new NotFoundException(
        'WhatsApp Business Account is not configured for this project. Please configure WhatsApp credentials first.',
      );
    }

    // Update campaign status to in-progress
    await this.update(campaignId, { status: 'in-progress' }, adminId);

    const results = {
      sent: 0,
      failed: 0,
      errors: [] as any[],
      messageIds: [] as string[],
    };

    // Send messages to each contact
    for (const contact of contacts) {
      try {
        const messageResult = await this.sendTemplateMessageToContact(
          project,
          contact,
          campaign.messageTemplate.templateName,
          bodyVariables,
          language,
          headerMediaAssetId,
        );

        // Create WABA message record
        await this.wabaMessageService.create({
          projectId: project._id.toString(),
          adminId: adminId,
          campaignId: campaignId,
          contactId: contact.contactId,
          wabaMessageId: messageResult.messages[0].id,
          messageType: 'campaign',
          templateName: campaign.messageTemplate.templateName,
        });

        results.sent++;
        results.messageIds.push(messageResult.messages[0].id);

        this.logger.log(
          `Message sent successfully to ${contact.phoneNumber}. Message ID: ${messageResult.messages[0].id}`,
        );

        // Add a delay between messages to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error) {
        results.failed++;
        results.errors.push({
          contactId: contact.contactId,
          phoneNumber: contact.phoneNumber,
          error: error.response?.data?.error || error.message,
        });

        this.logger.error(
          `Failed to send message to ${contact.phoneNumber} (Contact ID: ${contact.contactId})`,
          error.response?.data?.error,
        );
      }
    }

    // Update campaign analytics
    const analyticsData = {
      total: contacts.length,
      sent: results.sent,
      failed: results.failed,
      delivered: 0,
      read: 0,
      clicked: 0,
    };

    await this.updateAnalytics(campaignId, analyticsData);

    // Update campaign status
    const finalStatus =
      results.failed === contacts.length ? 'failed' : 'completed';
    await this.update(campaignId, { status: finalStatus }, adminId);

    this.logger.log(
      `Campaign execution completed. Sent: ${results.sent}, Failed: ${results.failed}`,
    );

    return {
      ...results,
      totalContacts: contacts.length,
      campaignId,
      status: finalStatus,
    };
  }

  /**
   * Send template message to a single contact
   * Similar to WhatsApp service's sendTemplateMessage method
   */
  private async sendTemplateMessageToContact(
    project: any,
    contact: any,
    templateName: string,
    bodyVariables?: string[],
    language?: string,
    headerMediaAssetId?: string,
  ): Promise<any> {
    const { permanentAccessToken, phoneNumberId } = project;
    const apiVersion = this.configService.get('GRAPH_API_VERSION') || 'v23.0';
    const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

    // Construct the Meta payload
    const metaPayload: any = {
      messaging_product: 'whatsapp',
      to: contact.phoneNumber,
      type: 'template',
      template: {
        name: templateName,
        language: {
          code: language || 'en_US',
        },
        components: [],
      },
    };

    // Add header component if media asset ID is provided
    if (headerMediaAssetId) {
      metaPayload.template.components.push({
        type: 'header',
        parameters: [
          {
            type: 'media',
            media: {
              id: headerMediaAssetId,
            },
          },
        ],
      });
    }

    // Add body component if variables are provided
    if (bodyVariables && bodyVariables.length > 0) {
      metaPayload.template.components.push({
        type: 'body',
        parameters: bodyVariables.map((variable) => ({
          type: 'text',
          text: variable,
        })),
      });
    }

    // Remove components array if empty
    if (metaPayload.template.components.length === 0) {
      delete metaPayload.template.components;
    }

    try {
      const response = await firstValueFrom(
        this.httpService.post(url, metaPayload, {
          headers: { Authorization: `Bearer ${permanentAccessToken}` },
        }),
      );

      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.error(
        `Failed to send template message to ${contact.phoneNumber}`,
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
        (axiosError.response?.data as any)?.error?.message ||
          'Could not send template message.',
      );
    }
  }

  /**
   * Process webhook payload for message status updates
   * Similar to WhatsApp service's processWebhookPayload method
   */
  async processWebhookPayload(payload: any): Promise<void> {
    this.logger.log('Processing webhook payload for campaign messages');

    try {
      // Process status updates
      if (payload.entry?.[0]?.changes?.[0]?.value?.statuses) {
        const statuses = payload.entry[0].changes[0].value.statuses;

        for (const status of statuses) {
          await this.updateMessageStatus(
            status.id,
            status.status,
            status.timestamp,
            status.errors?.[0]?.message,
          );
        }
      }

      // Process incoming messages (if needed)
      if (payload.entry?.[0]?.changes?.[0]?.value?.messages) {
        const messages = payload.entry[0].changes[0].value.messages;
        this.logger.log(`Received ${messages.length} incoming messages`);
        // Handle incoming messages if needed
      }
    } catch (error) {
      this.logger.error('Error processing webhook payload', error);
    }
  }

  /**
   * Update message status and campaign analytics
   */
  async updateMessageStatus(
    wabaMessageId: string,
    status: string,
    timestamp: string,
    failureReason?: string,
  ): Promise<void> {
    try {
      // Update WABA message status
      await this.wabaMessageService.updateStatus(
        wabaMessageId,
        status,
        failureReason,
      );

      // Get the message to find its campaign
      const message =
        await this.wabaMessageService.findByWabaMessageId(wabaMessageId);

      if (message) {
        // Only update campaign analytics if campaign exists
        if (message.campaignId) {
          await this.updateCampaignAnalyticsFromMessageStatus(
            message.campaignId.toString(),
            status,
          );
        } else {
          // Handle individual message (optional analytics)
          this.logger.log(`Individual message ${wabaMessageId} status updated to ${status}`);
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to update message status for ${wabaMessageId}`,
        error,
      );
    }
  }

  /**
   * Update campaign analytics based on message status changes
   */
  private async updateCampaignAnalyticsFromMessageStatus(
    campaignId: string,
    status: string,
  ): Promise<void> {
    try {
      const campaign = await this.campaignModel.findById(campaignId).lean();
      if (!campaign) return;

      const analytics = { ...campaign.analyticsSummary };
      console.log('updating --------------- > analytics', analytics);
      // Update analytics based on status
      switch (status) {
        case 'delivered':
          analytics.delivered = (analytics.delivered || 0) + 1;
          break;
        case 'read':
          analytics.read = (analytics.read || 0) + 1;
          break;
        case 'clicked':
          analytics.clicked = (analytics.clicked || 0) + 1;
          break;
        case 'failed':
          analytics.failed = (analytics.failed || 0) + 1;
          break;
      }

      await this.updateAnalytics(campaignId, analytics);
    } catch (error) {
      this.logger.error(
        `Failed to update campaign analytics for ${campaignId}`,
        error,
      );
    }
  }

  /**
   * Get campaign execution results with detailed message status
   */
  async getCampaignExecutionResults(
    campaignId: string,
    adminId: string,
  ): Promise<any> {
    const campaign = await this.findOne(campaignId, adminId);
    const messages =
      await this.wabaMessageService.getCampaignMessages(campaignId);
    const messageStats =
      await this.wabaMessageService.getMessageStats(campaignId);

    return {
      campaign: {
        id: campaign._id,
        name: campaign.name,
        status: campaign.status,
        analyticsSummary: campaign.analyticsSummary,
        createdAt: (campaign as any).createdAt,
        completedAt: campaign.completedAt,
      },
      messages: messages.map((msg) => ({
        id: msg._id,
        contactId: msg.contactId,
        wabaMessageId: msg.wabaMessageId,
        status: msg.status,
        statusHistory: msg.statusHistory,
        failureReason: msg.failureReason,
        sentAt: msg.sentAt,
        deliveredAt: msg.deliveredAt,
        readAt: msg.readAt,
      })),
      statistics: messageStats,
    };
  }

  /**
   * Process scheduled campaigns that are due for execution
   */
  async processScheduledCampaigns(): Promise<void> {
    const scheduledCampaigns = await this.getScheduledCampaigns();
    
    this.logger.log(`Found ${scheduledCampaigns.length} scheduled campaigns ready for execution`);

    for (const campaign of scheduledCampaigns) {
      try {
        this.logger.log(`Processing scheduled campaign: ${campaign._id} - ${campaign.name}`);
        
        // Prepare execution data from stored campaign data
        const executionData = await this.prepareCampaignExecutionData(campaign);
        
        // Execute the campaign
        await this.executeCampaign(executionData, campaign.adminId.toString());
        
        this.logger.log(`Scheduled campaign ${campaign._id} executed successfully`);
      } catch (error) {
        this.logger.error(`Failed to execute scheduled campaign ${campaign._id}:`, error);
        
        // Update campaign status to failed
        await this.update(campaign._id.toString(), { status: 'failed' }, campaign.adminId.toString());
      }
    }
  }

  /**
   * Prepare campaign execution data from stored campaign data
   */
  private async prepareCampaignExecutionData(campaign: any): Promise<ExecuteCampaignDto> {
    if (!campaign.storedCampaignData) {
      throw new Error(`Campaign ${campaign._id} does not have stored execution data`);
    }

    const { contacts, bodyVariables, language, variableMappings, headerMediaAssetId } = campaign.storedCampaignData;

    return {
      campaignId: campaign._id.toString(),
      contacts: contacts,
      bodyVariables: bodyVariables,
      language: language,
      headerMediaAssetId: headerMediaAssetId,
    };
  }

  /**
   * Cancel a scheduled campaign
   */
  async cancelScheduledCampaign(campaignId: string, adminId: string): Promise<Campaign> {
    const campaign = await this.findOne(campaignId, adminId);
    
    if (campaign.status !== 'draft' || !campaign.scheduledAt) {
      throw new BadRequestException('Only scheduled draft campaigns can be cancelled');
    }
    
    return this.update(campaignId, { 
      scheduledAt: null,
      storedCampaignData: null,
    }, adminId);
  }

  /**
   * Reschedule a campaign
   */
  async rescheduleCampaign(campaignId: string, newScheduledAt: string, adminId: string): Promise<Campaign> {
    const campaign = await this.findOne(campaignId, adminId);
    
    if (campaign.status !== 'draft') {
      throw new BadRequestException('Only draft campaigns can be rescheduled');
    }
    
    return this.update(campaignId, { 
      scheduledAt: new Date(newScheduledAt).toISOString() 
    }, adminId);
  }
}
