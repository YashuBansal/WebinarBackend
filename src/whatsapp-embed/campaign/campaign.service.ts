import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Campaign,
  CampaignContactType,
  CampaignDocument,
  CampaignStatus,
} from '../../schemas/whatsapp-embed/campaign.schema';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { ExecuteCampaignDto } from './dto/execute-campaign.dto';
import { CreateCampaignWorkflowDto } from './dto/create-campaign-workflow.dto';
import { PaginatedCampaignsResponseDto } from './dto/paginated-campaigns-response.dto';
import { WabaMessageService } from '../waba-message/waba-message.service';
import { ProjectsService } from '../../projects/projects.service';
import { WhatsappService } from '../../whatsapp/whatsapp.service';
import { v4 as uuidv4 } from 'uuid';
import { AttendeesService } from 'src/attendees/attendees.service';
import { ContactsService } from 'src/contacts/contacts.service';
import { WabaMessageType } from 'src/whatsapp-embed/waba-message/waba-message.schema';
import { AdvanceFilterResponseType } from 'src/attendees/dto/advance-attendee-filters.dto';

@Injectable()
export class CampaignService {
  private readonly logger = new Logger(CampaignService.name);

  constructor(
    @InjectModel(Campaign.name) private campaignModel: Model<CampaignDocument>,
    private readonly wabaMessageService: WabaMessageService,
    private readonly projectService: ProjectsService,
    private readonly whatsappService: WhatsappService,
    private readonly attendeesService: AttendeesService,
    private readonly contactsService: ContactsService,
  ) {}

  /**
   * Validate that a scheduled time is in the future
   */
  private validateScheduledTime(scheduledAt: Date) {
    const now = new Date();
    if (scheduledAt <= now) {
      throw new BadRequestException('Scheduled time must be in the future.');
    }
  }

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
      wlhAttendeeFilters,
      contactType,
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
      status: CampaignStatus.DRAFT,
      scheduledAt:
        sendType === 'scheduled' && scheduledAt
          ? (() => {
              const scheduledDate = new Date(scheduledAt);
              this.validateScheduledTime(scheduledDate);
              return scheduledDate;
            })()
          : undefined,
      headerMediaAssetId: headerMediaAssetId || undefined,
      storedCampaignData:
        sendType === 'scheduled'
          ? {
              contacts: selectedContacts,
              bodyVariables:
                variableMappings?.map((mapping) => {
                  // For backward compatibility, if isDynamic is not set, use the old behavior
                  if (mapping.isDynamic === undefined) {
                    return mapping.contactField;
                  }
                  // For new dynamic/static structure
                  return mapping.isDynamic
                    ? mapping.contactField
                    : mapping.staticValue || '';
                }) || [],
              dynamicVariables:
                variableMappings?.map((mapping) => {
                  // For backward compatibility, if isDynamic is not set, assume dynamic
                  if (mapping.isDynamic === undefined) {
                    return true; // Old behavior assumed all variables were dynamic
                  }
                  return mapping.isDynamic;
                }) || [],
              fallbackValues:
                variableMappings?.map((mapping) => {
                  return mapping.fallbackValue || '';
                }) || [],
              language: 'en_US',
              variableMappings: variableMappings || [],
              headerMediaAssetId: headerMediaAssetId || undefined,
            }
          : undefined,

      wlhAttendeeFilters:
        contactType === CampaignContactType.WLH
          ? wlhAttendeeFilters
          : undefined,
      contactType,
    });

    const savedCampaign = await campaign.save();

    // If sendType is 'now', execute the campaign immediately
    if (sendType === 'now') {
      this.executeCampaign(
        {
          campaignId: savedCampaign._id.toString(),
          contacts: selectedContacts,
          bodyVariables:
            variableMappings?.map((mapping) => {
              // For backward compatibility, if isDynamic is not set, use the old behavior
              if (mapping.isDynamic === undefined) {
                return mapping.contactField;
              }
              // For new dynamic/static structure
              return mapping.isDynamic
                ? mapping.contactField
                : mapping.staticValue || '';
            }) || [],
          dynamicVariables:
            variableMappings?.map((mapping) => {
              // For backward compatibility, if isDynamic is not set, assume dynamic
              if (mapping.isDynamic === undefined) {
                return true; // Old behavior assumed all variables were dynamic
              }
              return mapping.isDynamic;
            }) || [],
          fallbackValues:
            variableMappings?.map((mapping) => {
              return mapping.fallbackValue || '';
            }) || [],
          language: 'en_US',
          headerMediaAssetId: headerMediaAssetId || undefined,
          wlhAttendeeFilters:
            contactType === CampaignContactType.WLH
              ? wlhAttendeeFilters
              : undefined,
          contactType,
        },
        adminId,
      ).catch((error) => {
        this.logger.error('Failed to execute campaign immediately:', error);
        this.update(
          savedCampaign._id.toString(),
          { status: CampaignStatus.FAILED },
          adminId,
        );
      });
    }

    // For scheduled campaigns, return campaign details
    return {
      campaign: savedCampaign,
      executionResult: null,
      sampleMessage: {},
      totalRecipients: selectedContacts.length,
    };
  }

  /**
   * Generate sample message for preview
   */
  // private generateSampleMessage(
  //   templateBody: string,
  //   variableMappings: any[],
  //   sampleContact: any,
  // ): string {
  //   if (!variableMappings || variableMappings.length === 0) {
  //     return templateBody;
  //   }

  //   let message = templateBody;
  //   variableMappings.forEach((mapping) => {
  //     const placeholder = mapping.variable;
  //     let value = '';

  //     if (mapping.isDynamic) {
  //       // Use contact field value with fallback
  //       const contactField = mapping.contactField.replace('$', ''); // Remove $ prefix
  //       const contactValue = sampleContact[contactField];

  //       // Use contact value if available, otherwise use fallback value
  //       if (contactValue && contactValue.trim() !== '') {
  //         value = contactValue;
  //       } else {
  //         value = mapping.fallbackValue || placeholder;
  //       }
  //     } else {
  //       // Use static value
  //       value = mapping.staticValue || placeholder;
  //     }

  //     message = message.replace(
  //       new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'),
  //       value,
  //     );
  //   });

  //   return message;
  // }

  async findAll(
    adminId: string,
    projectId?: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedCampaignsResponseDto> {
    const filter: any = {
      adminId: new Types.ObjectId(adminId),
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

  async findOne(id: string, adminId: string): Promise<any> {
    const campaign = await this.campaignModel
      .findOne({
        _id: new Types.ObjectId(id),
        adminId: new Types.ObjectId(adminId),
        isDeleted: false,
      })
      .exec();

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    // Calculate analytics at runtime from WABA messages
    const analyticsData = await this.calculateCampaignAnalytics(
      campaign._id.toString(),
    );

    // Update campaign with real-time analytics
    campaign.analyticsSummary = analyticsData;

    // Save the updated analytics to the database
    await this.updateAnalytics(campaign._id.toString(), analyticsData);

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

    if (updateCampaignDto.status === CampaignStatus.COMPLETED) {
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
    const campaign = await this.campaignModel
      .findOne({
        _id: new Types.ObjectId(id),
        adminId: new Types.ObjectId(adminId),
        isDeleted: false,
      })
      .exec();

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    if (campaign.status === CampaignStatus.COMPLETED) {
      throw new BadRequestException('Completed campaigns cannot be deleted');
    }

    await this.campaignModel
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

  async updateAnalytics(
    campaignId: string,
    analyticsData: any,
  ): Promise<Campaign> {
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
        status: CampaignStatus.DRAFT,
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
    const {
      contactType,
      wlhAttendeeFilters,
      campaignId,
      contacts,
      bodyVariables: rawBodyVariables,
      dynamicVariables: rawDynamicVariables,
      fallbackValues: rawFallbackValues,
      headerMediaAssetId,
      language,
    } = executeCampaignDto;

    // For scheduled campaigns, bodyVariables and dynamicVariables are already processed
    // For immediate campaigns, we need to process them
    let bodyVariables: string[];
    let dynamicVariables: boolean[];
    let fallbackValues: string[];

    if (rawDynamicVariables && rawDynamicVariables.length > 0) {
      // This is a scheduled campaign - variables are already processed
      bodyVariables = rawBodyVariables || [];
      dynamicVariables = rawDynamicVariables;
      fallbackValues = rawFallbackValues || [];
    } else {
      // This is an immediate campaign - process the variables
      const processedVariables =
        rawBodyVariables?.map((value, index) => {
          const isDynamic = rawDynamicVariables?.[index] || false;
          return {
            value,
            isDynamic,
          };
        }) || [];

      bodyVariables = processedVariables.map((v) => v.value);
      dynamicVariables = processedVariables.map((v) => v.isDynamic);
      fallbackValues = rawFallbackValues || [];
    }

    this.logger.log(
      `Executing campaign ${campaignId} for ${contacts.length} contacts`,
    );

    // Get campaign details
    const campaign = await this.findOne(campaignId, adminId);
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    if (campaign.status !== CampaignStatus.DRAFT) {
      throw new BadRequestException(
        'Campaign can only be executed when in draft status',
      );
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

    // Fetch template data from Meta to get the language
    let templateLanguage = language || 'en_US'; // Default fallback
    try {
      const metaTemplates = await this.whatsappService.getTemplatesForWaba(
        new Types.ObjectId(adminId),
        campaign.project,
        { name: campaign.messageTemplate.templateName },
      );

      if (metaTemplates && metaTemplates.length > 0) {
        const metaTemplate = metaTemplates.find(
          (t) => t.name === campaign.messageTemplate.templateName,
        ) || metaTemplates[0];
        templateLanguage = metaTemplate.language || language || 'en_US';
        this.logger.log(
          `Retrieved template language from Meta: ${templateLanguage} for template: ${campaign.messageTemplate.templateName}`,
        );
      } else {
        this.logger.warn(
          `Template ${campaign.messageTemplate.templateName} not found in Meta. Using ${templateLanguage}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to fetch template language from Meta for ${campaign.messageTemplate.templateName}. Using ${templateLanguage}`,
        error.message,
      );
    }

    // Update campaign status to in-progress
    await this.update(
      campaignId,
      { status: CampaignStatus.IN_PROGRESS },
      adminId,
    );

    const results = {
      sent: 0,
      failed: 0,
      errors: [] as any[],
      messageIds: [] as string[],
    };
    this.logger.log('contactType', contactType);
    // Send messages to each contact using the unified WhatsApp service method
    if (contactType === CampaignContactType.WHATSAPP) {
      const fetchedContacts = await this.contactsService.getContactsByIds(
        new Types.ObjectId(`${adminId}`),
        contacts.map((contact) => new Types.ObjectId(contact.contactId)),
      );

      for (const contact of fetchedContacts) {
        try {
          // Process variables with fallback values for this specific contact
          const processedBodyVariables = bodyVariables.map(
            (variable, index) => {
              const isDynamic = dynamicVariables[index];
              const fallbackValue = fallbackValues[index];

              if (isDynamic) {
                // Extract field name from variable (e.g., "$firstName" -> "firstName")
                const fieldName = variable.replace('$', '');
                const contactValue = contact[fieldName];

                // Use contact value if available and not empty, otherwise use fallback
                if (contactValue && contactValue.trim() !== '') {
                  return contactValue;
                } else {
                  return fallbackValue || variable;
                }
              } else {
                // Static variable, use as-is
                return variable;
              }
            },
          );

          const messageResult =
            await this.whatsappService.sendSingleTemplateMessage({
              adminId: new Types.ObjectId(`${adminId}`),
              projectId: project._id.toString(),
              recipientPhoneNumber: contact.phone,
              templateName: campaign.messageTemplate.templateName,
              bodyVariables: processedBodyVariables,
              headerMediaAssetId,
              language: templateLanguage,
              contactId: contact._id.toString(),
              messageType: WabaMessageType.CAMPAIGN,
              campaignId,
            });

          results.sent++;
          results.messageIds.push(messageResult.messages[0].id);

          this.logger.log(
            `Message sent successfully to ${contact.phone}. Message ID: ${messageResult.messages[0].id}`,
          );

          // Add a delay between messages to avoid rate limiting
          await new Promise((resolve) => setTimeout(resolve, 200));
        } catch (error) {
          results.failed++;
          results.errors.push({
            contactId: contact._id.toString(),
            phoneNumber: contact.phone,
            error: error.response?.data?.error || error.message,
          });

          this.logger.error(
            `Failed to send message to ${contact.phone} (Contact ID: ${contact._id.toString()})`,
            error.response?.data?.error,
          );
        }
      }
    } else {
      const webinarIds = wlhAttendeeFilters.filters.webinarIds;
      const conditions = wlhAttendeeFilters.filters.conditions;
      const isAttended = wlhAttendeeFilters.isAttended;
      const responseType = AdvanceFilterResponseType.DATA;
      this.logger.log(
        `webinarIds: ${webinarIds}, conditions: ${JSON.stringify(conditions, null, 2)}`,
      );

      // Fetch attendees using advance filters
      // Supports multiple webinars per campaign with a single global attendance segment
      const advanceResult =
        await this.attendeesService.fetchAttendeesByAdvanceFilters(
          {
            isAttended: isAttended,
            responseType: responseType,
            units: conditions,
            webinarIds: webinarIds,
          },
          adminId,
        );

      const attendeeResults = advanceResult.data || [];

      this.logger.log(
        `Total unique attendees from ${webinarIds.length} webinars: ${attendeeResults.length}`,
      );

      for (const contact of attendeeResults) {
        try {
          // Process variables with fallback values for this specific contact
          const processedBodyVariables = bodyVariables.map(
            (variable, index) => {
              const isDynamic = dynamicVariables[index];
              const fallbackValue = fallbackValues[index];

              if (isDynamic) {
                // Extract field name from variable (e.g., "$firstName" -> "firstName")
                const fieldName = variable.replace('$', '');
                const contactValue = contact[fieldName];

                // Use contact value if available and not empty, otherwise use fallback
                if (
                  contactValue &&
                  ((typeof contactValue === 'string' &&
                    contactValue.trim() !== '') ||
                    typeof contactValue === 'number')
                ) {
                  return contactValue.toString();
                } else {
                  return fallbackValue || variable;
                }
              } else {
                // Static variable, use as-is
                return variable;
              }
            },
          );

          const messageResult =
            await this.whatsappService.sendSingleTemplateMessage({
              adminId: new Types.ObjectId(`${adminId}`),
              projectId: project._id.toString(),
              recipientPhoneNumber: contact.phone,
              templateName: campaign.messageTemplate.templateName,
              bodyVariables: processedBodyVariables,
              headerMediaAssetId,
              language: templateLanguage,
              attendeeId: contact._id,
              messageType: WabaMessageType.CAMPAIGN,
              campaignId,
            });

          results.sent++;
          results.messageIds.push(messageResult.messages[0].id);

          this.logger.log(
            `Message sent successfully to ${contact.phone}. Message ID: ${messageResult.messages[0].id}`,
          );

          // Add a delay between messages to avoid rate limiting
          await new Promise((resolve) => setTimeout(resolve, 200));
        } catch (error) {
          results.failed++;
          results.errors.push({
            contactId: contact?._id,
            phoneNumber: contact?.phone,
            error: error.response?.data?.error || error.message,
          });

          this.logger.error(
            `Failed to send message to ${contact.phone} (Contact ID: ${contact._id})`,
            error.response?.data?.error,
          );
        }
      }
    }

    // Update campaign status
    const finalStatus = CampaignStatus.COMPLETED;
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
   * Get header component for media using WhatsApp service logic
   */
  private async getHeaderComponentForMedia(
    headerMediaAssetId: string,
    templateName: string,
    adminId: string,
    projectId: Types.ObjectId,
  ): Promise<any> {
    // Get template details to determine header format
    const templates = await this.whatsappService.getTemplatesForWaba(
      new Types.ObjectId(adminId),
      projectId,
      { name: templateName },
    );

    const ourTemplate = templates.find(
      (template: any) => template.name === templateName,
    );

    if (!ourTemplate) {
      throw new NotFoundException(`Template '${templateName}' not found`);
    }

    this.logger.log('templateDetails', ourTemplate);
    const headerComponent = ourTemplate.components.find(
      (c) => c.type === 'HEADER',
    );

    if (!headerComponent) {
      return null;
    }

    const headerFormat = headerComponent.format;
    let headerParameter: any;

    // Use the correct media parameter structure based on format
    switch (headerFormat) {
      case 'IMAGE':
        headerParameter = {
          type: 'image',
          image: {
            id: headerMediaAssetId,
          },
        };
        break;
      case 'VIDEO':
        headerParameter = {
          type: 'video',
          video: {
            id: headerMediaAssetId,
          },
        };
        break;
      case 'DOCUMENT':
        headerParameter = {
          type: 'document',
          document: {
            id: headerMediaAssetId,
          },
        };
        break;
      default:
        throw new BadRequestException(
          `Unsupported header format: ${headerFormat}`,
        );
    }

    return {
      type: 'header',
      parameters: [headerParameter],
    };
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
      // const message =
      //   await this.wabaMessageService.findByWabaMessageId(wabaMessageId);

      // if (message) {
      //   // Only update campaign analytics if campaign exists
      //   if (message.campaignId) {
      //     await this.updateCampaignAnalyticsFromMessageStatus(
      //       message.campaignId.toString(),
      //       status,
      //     );
      //   } else {
      //     // Handle individual message (optional analytics)
      //     this.logger.log(`Individual message ${wabaMessageId} status updated to ${status}`);
      //   }
      // }
    } catch (error) {
      this.logger.error(
        `Failed to update message status for ${wabaMessageId}`,
        error,
      );
    }
  }

  /**
   * Calculate campaign analytics at runtime from WABA messages
   */
  private async calculateCampaignAnalytics(campaignId: string): Promise<any> {
    try {
      // Get message statistics from WABA messages
      const messageStats = await this.wabaMessageService.getMessageStats({
        campaignId: new Types.ObjectId(campaignId),
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
        `Calculated analytics for campaign ${campaignId}:`,
        analyticsData,
      );
      return analyticsData;
    } catch (error) {
      this.logger.error(
        `Failed to calculate campaign analytics for ${campaignId}`,
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

  /**
   * Update campaign analytics based on message status changes
   */
  // private async updateCampaignAnalyticsFromMessageStatus(
  //   campaignId: string,
  //   status: string,
  // ): Promise<void> {
  //   try {
  //     const campaign = await this.campaignModel.findById(campaignId).lean();
  //     if (!campaign) return;

  //     const analytics = { ...campaign.analyticsSummary };
  //     console.log('updating --------------- > analytics', analytics);
  //     // Update analytics based on status
  //     switch (status) {
  //       case 'delivered':
  //         analytics.delivered = (analytics.delivered || 0) + 1;
  //         break;
  //       case 'read':
  //         analytics.read = (analytics.read || 0) + 1;
  //         break;
  //       case 'clicked':
  //         analytics.clicked = (analytics.clicked || 0) + 1;
  //         break;
  //       case 'failed':
  //         analytics.failed = (analytics.failed || 0) + 1;
  //         break;
  //     }

  //     await this.updateAnalytics(campaignId, analytics);
  //   } catch (error) {
  //     this.logger.error(
  //       `Failed to update campaign analytics for ${campaignId}`,
  //       error,
  //     );
  //   }
  // }

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
    const messageStats = await this.wabaMessageService.getMessageStats({
      campaignId: new Types.ObjectId(campaignId),
    });

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
   * Get campaign report data for download (all messages without pagination)
   */
  async getCampaignReportForDownload(
    campaignId: string,
    adminId: string,
  ): Promise<any> {
    const campaign = await this.findOne(campaignId, adminId);
    const messages =
      await this.wabaMessageService.getCampaignMessages(campaignId);
    const messageStats = await this.wabaMessageService.getMessageStats({
      campaignId: new Types.ObjectId(campaignId),
    });

    // Format messages for CSV export
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
        id: campaign._id,
        name: campaign.name,
        status: campaign.status,
        createdAt: campaign.createdAt,
        completedAt: campaign.completedAt,
        scheduledAt: campaign.scheduledAt,
      },
      messages: formattedMessages,
      statistics: messageStats,
      totalMessages: messages.length,
    };
  }

  /**
   * Process scheduled campaigns that are due for execution
   */
  async processScheduledCampaigns(): Promise<void> {
    const scheduledCampaigns = await this.getScheduledCampaigns();

    this.logger.log(
      `Found ${scheduledCampaigns.length} scheduled campaigns ready for execution`,
    );

    for (const campaign of scheduledCampaigns) {
      try {
        this.logger.log(
          `Processing scheduled campaign: ${campaign._id} - ${campaign.name}`,
        );

        // Prepare execution data from stored campaign data
        const executionData = await this.prepareCampaignExecutionData(campaign);

        // Execute the campaign
        await this.executeCampaign(executionData, campaign.adminId.toString());

        this.logger.log(
          `Scheduled campaign ${campaign._id} executed successfully`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to execute scheduled campaign ${campaign._id}:`,
          error,
        );

        // Update campaign status to failed
        await this.update(
          campaign._id.toString(),
          { status: CampaignStatus.FAILED },
          campaign.adminId.toString(),
        );
      }
    }
  }

  /**
   * Prepare campaign execution data from stored campaign data
   */
  private async prepareCampaignExecutionData(
    campaign: any,
  ): Promise<ExecuteCampaignDto> {
    if (!campaign.storedCampaignData) {
      throw new Error(
        `Campaign ${campaign._id} does not have stored execution data`,
      );
    }

    const {
      contacts,
      bodyVariables,
      dynamicVariables,
      fallbackValues,
      language,
      variableMappings,
      headerMediaAssetId,
    } = campaign.storedCampaignData;

    return {
      campaignId: campaign._id.toString(),
      contacts: contacts,
      bodyVariables: bodyVariables,
      dynamicVariables: dynamicVariables,
      fallbackValues: fallbackValues || [],
      language: language,
      headerMediaAssetId: headerMediaAssetId,
      contactType: campaign.contactType,
      wlhAttendeeFilters: campaign.wlhAttendeeFilters,
    };
  }

  /**
   * Cancel a scheduled campaign
   */
  async cancelScheduledCampaign(
    campaignId: string,
    adminId: string,
  ): Promise<Campaign> {
    const campaign = await this.findOne(campaignId, adminId);

    if (campaign.status !== CampaignStatus.DRAFT || !campaign.scheduledAt) {
      throw new BadRequestException(
        'Only scheduled draft campaigns can be cancelled',
      );
    }

    return this.update(
      campaignId,
      {
        scheduledAt: null,
        storedCampaignData: null,
      },
      adminId,
    );
  }

  /**
   * Reschedule a campaign
   */
  async rescheduleCampaign(
    campaignId: string,
    newScheduledAt: string,
    adminId: string,
  ): Promise<Campaign> {
    const campaign = await this.findOne(campaignId, adminId);

    if (campaign.status !== CampaignStatus.DRAFT) {
      throw new BadRequestException('Only draft campaigns can be rescheduled');
    }

    const newDate = new Date(newScheduledAt);
    this.validateScheduledTime(newDate);

    return this.update(
      campaignId,
      {
        scheduledAt: newDate.toISOString(),
      },
      adminId,
    );
  }
}
