import {
  Injectable,
  forwardRef,
  Inject,
  Logger,
  ForbiddenException,
  InternalServerErrorException,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from 'src/users/users.service';
import axios, { AxiosError, AxiosInstance } from 'axios';
import * as http from 'http';
import axiosRetry from 'axios-retry';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Queue } from 'bullmq';
import { ProjectsService } from 'src/projects/projects.service';
import { WabaMessageService } from 'src/whatsapp-embed/waba-message/waba-message.service';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ValidationUtil } from 'src/common/utils/validation.util';
import { MonitoringUtil } from 'src/common/utils/monitoring.util';
import {
  CreateTemplateDto,
  UpdateTemplateDto,
  GetTemplatesQueryDto,
  DeleteTemplateDto,
  TemplateResponseDto,
} from './dto/template.dto';
import {
  SendTemplateMessageDto,
  SendBulkTemplateMessageDto,
  ISendSingleTemplateMessagePayload,
  IFormattedPhoneData,
} from './dto/msg.dto';
import { MediaAsset, MediaAssetDocument } from './schemas/media-asset.schema';
import { ContactsService } from 'src/contacts/contacts.service';
import { FileStorageService } from 'src/file-storage/file-storage.service';
import { ConfiguredTemplate } from 'src/configured-templates/schema/configured-template.schema';
import { WabaMessageType } from 'src/whatsapp-embed/waba-message/waba-message.schema';
import { WhatsAppGateway } from 'src/websocket/whatsapp.gateway';
import { CampaignStatus } from 'src/whatsapp-embed/campaign/campaign.schema';
import {
  WHATSAPP_TEMPLATE_QUEUE,
  WHATSAPP_TEMPLATE_QUEUE_NAME,
  WHATSAPP_WEBHOOK_QUEUE,
} from './whatsapp.queue.module';
import { WabaTemplateService } from 'src/whatsapp-embed/waba-template/waba-template.service';
import { WabaTemplateDocument } from 'src/whatsapp-embed/waba-template/waba-template.schema';
import { BaseLoggerService } from 'src/logger/base-logger.service';

@Injectable()
export class WhatsappService extends BaseLoggerService {
  private readonly webhookVerifyToken: string;
  private readonly axiosInstance: AxiosInstance;

  constructor(
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
    private readonly projectService: ProjectsService,
    @InjectModel(MediaAsset.name)
    private readonly mediaAssetModel: Model<MediaAssetDocument>,
    private readonly contactsService: ContactsService,
    private readonly wabaMessageService: WabaMessageService,
    private readonly fileStorageService: FileStorageService,
    private readonly whatsAppGateway: WhatsAppGateway,
    @Inject(WHATSAPP_TEMPLATE_QUEUE)
    private readonly whatsappTemplateQueue: Queue,
    @Inject(WHATSAPP_WEBHOOK_QUEUE)
    private readonly whatsappWebhookQueue: Queue,
    @Inject(forwardRef(() => WabaTemplateService))
    private readonly wabaTemplateService: WabaTemplateService,
  ) {
    super();
    this.webhookVerifyToken = this.configService.get<string>(
      'META_WEBHOOK_VERIFY_TOKEN',
    );

    // Initialize robust axios instance with IPv4 agent and retry logic
    const httpAgent = new http.Agent({ family: 4 });
    this.axiosInstance = axios.create({
      httpAgent: httpAgent,
    });

    // Apply automatic retry mechanism
    axiosRetry(this.axiosInstance, {
      retries: 3,
      retryDelay: (retryCount) => {
        this.logger.warn(
          `Request failed. Retrying in ${retryCount * 2}s... (Attempt ${retryCount})`,
        );
        return retryCount * 2000;
      },
      retryCondition: (error) => {
        return (
          axiosRetry.isNetworkOrIdempotentRequestError(error) ||
          error.code === 'ETIMEDOUT'
        );
      },
    });
  }

  url = this.configService.get('AISENSY_URL');
  apiKey: string | null = null;

  onModuleInit() {
    this.usersService.getSuperAdminDetails(true).then((superAdmin) => {
      console.log('superAdmin -------- >', superAdmin);
      if (superAdmin?.whatsappToken) {
        this.apiKey = superAdmin.whatsappToken;
      }
    });
  }

  /**
   * Verifies the token sent by Meta during the webhook setup challenge.
   * @param mode The 'hub.mode' query param (should be 'subscribe').
   * @param token The 'hub.verify_token' query param.
   * @throws ForbiddenException if the mode is not 'subscribe' or the token is invalid.
   */
  verifyWebhookToken(mode: string, token: string): void {
    // Check if the mode and token are present and correct
    if (mode === 'subscribe' && token === this.webhookVerifyToken) {
      this.logger.log('Webhook token verified successfully.');
      return;
    } else {
      // If they don't match, throw an error. Meta will see this as a failed verification.
      throw new ForbiddenException(
        'Webhook verification failed: Invalid token or mode.',
      );
    }
  }

  /**
   * Enqueues the webhook payload for background processing.
   * This ensures the controller can respond with 200 OK immediately.
   */
  async enqueueWebhookProcessing(payload: any) {
    // Add to webhook queue
    await this.whatsappWebhookQueue.add('process-webhook', payload, {
      removeOnComplete: { age: 24 * 3600 },
      removeOnFail: { count: 1000 },
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
    });
  }

  /**
   * Processes the incoming data payload from Meta.
   * Executed by the worker.
   * @param payload The body of the POST request from Meta's webhook.
   */
  async processWebhookPayload(payload: any): Promise<void> {
    // Wrap entire processing in try-catch to ensure no unhandled errors
    // This method is called asynchronously from the controller, so errors must be caught
    try {
      this.logger.log(`Processing webhook payload for WhatsApp messages - ${JSON.stringify(payload)}`);

      // axios.post('http://localhost:3002/api/v1/whatsapp/webhook', payload)
      //   .then((response) => {
      //     // this.logger.log('Webhook payload processed successfully', response.data);
      //   })
      //   .catch((error) => {
      //     this.logger.error('Error processing webhook payload', error);
      //   });

      // Validate payload exists and is an object
      if (!payload) {
        this.logger.warn('Received null or undefined payload, skipping processing');
        return;
      }

      if (typeof payload !== 'object' || Array.isArray(payload)) {
        this.logger.warn(
          `Invalid payload type: ${typeof payload}, expected object. Skipping processing.`,
        );
        return;
      }

      // Validate payload structure
      if (!payload.entry) {
        this.logger.warn('Payload missing entry array, skipping processing');
        return;
      }

      if (!Array.isArray(payload.entry) || payload.entry.length === 0) {
        this.logger.warn(
          `Payload entry is not a valid array or is empty. Length: ${payload.entry?.length || 0}`,
        );
        return;
      }

      // Process status updates
      const firstEntry = payload.entry[0];
      if (!firstEntry || typeof firstEntry !== 'object') {
        this.logger.warn('First entry in payload is invalid, skipping status processing');
      } else {
        const changes = firstEntry.changes;
        if (
          changes &&
          Array.isArray(changes) &&
          changes.length > 0 &&
          changes[0] &&
          typeof changes[0] === 'object'
        ) {
          const changeValue = changes[0].value;
          if (changeValue && typeof changeValue === 'object') {
            // Process status updates and messages in parallel for better performance
            const processingPromises: Promise<void>[] = [];

            if (changeValue.statuses) {
              this.logger.log('Processing status updates from webhook payload');
              processingPromises.push(
                this.processStatusUpdates(changeValue.statuses).catch((error) => {
                  this.logger.error(
                    'Error processing status updates',
                    error instanceof Error ? error.stack : error,
                  );
                }),
              );
            }

            // Process incoming messages
            if (changeValue.messages) {
              this.logger.log('Processing incoming messages from webhook payload');
              processingPromises.push(
                this.processIncomingMessages(changeValue).catch((error) => {
                  this.logger.error(
                    'Error processing incoming messages',
                    error instanceof Error ? error.stack : error,
                  );
                }),
              );
            }

            // Wait for all processing to complete (errors already caught above)
            await Promise.allSettled(processingPromises);
          } else {
            this.logger.warn('Change value is missing or invalid, skipping processing');
          }
        } else {
          this.logger.warn('Changes array is missing, empty, or invalid');
        }
      }
    } catch (error) {
      // Catch any unexpected errors that might occur
      this.logger.error(
        'Unexpected error processing webhook payload',
        error instanceof Error ? error.stack : error,
      );
      // Don't rethrow - this is async processing, errors should be logged only
    }
  }

  /**
   * Processes status updates from webhook payload
   * @param statuses Array of status update objects
   */
  private async processStatusUpdates(statuses: any[]): Promise<void> {
    if (!Array.isArray(statuses)) {
      this.logger.warn('Statuses is not an array, skipping status processing');
      return;
    }

    if (statuses.length === 0) {
      this.logger.log('No status updates to process');
      return;
    }

    this.logger.log(`Processing ${statuses.length} status update(s)`);

    for (let i = 0; i < statuses.length; i++) {
      const status = statuses[i];
      if (!status || typeof status !== 'object') {
        this.logger.warn(`Status at index ${i} is invalid, skipping`);
        continue;
      }

      // Validate required fields
      const statusId = status.id;
      const statusValue = status.status;
      const timestamp = status.timestamp;

      if (!statusId || typeof statusId !== 'string' || statusId.trim() === '') {
        this.logger.warn(
          `Status at index ${i} has invalid or missing ID, skipping`,
        );
        continue;
      }

      if (
        !statusValue ||
        typeof statusValue !== 'string' ||
        statusValue.trim() === ''
      ) {
        this.logger.warn(
          `Status at index ${i} (ID: ${statusId}) has invalid or missing status value, skipping`,
        );
        continue;
      }

      if (!timestamp || (typeof timestamp !== 'string' && typeof timestamp !== 'number')) {
        this.logger.warn(
          `Status at index ${i} (ID: ${statusId}) has invalid or missing timestamp, skipping`,
        );
        continue;
      }

      const failureReason =
        status.errors && Array.isArray(status.errors) && status.errors.length > 0
          ? status.errors[0]?.message
          : undefined;

      // Process status updates asynchronously to avoid blocking the webhook response
      this.updateMessageStatus(
        statusId,
        statusValue,
        String(timestamp),
        failureReason,
      ).catch((error) => {
        this.logger.error(
          `Failed to process status update for message ID: ${statusId}, status: ${statusValue}`,
          error instanceof Error ? error.stack : error,
        );
      });
    }
  }

  /**
   * Processes incoming messages from webhook payload
   * @param changeValue The value object from the webhook change
   */
  private async processIncomingMessages(changeValue: any): Promise<void> {
    if (!changeValue || typeof changeValue !== 'object') {
      this.logger.warn('Change value is invalid, skipping message processing');
      return;
    }

    const messages = changeValue.messages;
    if (!Array.isArray(messages)) {
      this.logger.warn('Messages is not an array, skipping message processing');
      return;
    }

    if (messages.length === 0) {
      this.logger.log('No incoming messages to process');
      return;
    }

    const contacts = Array.isArray(changeValue.contacts)
      ? changeValue.contacts
      : [];
    const metadata =
      changeValue.metadata && typeof changeValue.metadata === 'object'
        ? changeValue.metadata
        : {};
    const fromPhoneNumberId =
      metadata && typeof metadata.phone_number_id === 'string'
        ? metadata.phone_number_id
        : undefined;

    this.logger.log(
      `Received ${messages.length} incoming message(s) from phone number ID: ${fromPhoneNumberId || 'unknown'}`,
    );

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg || typeof msg !== 'object') {
        this.logger.warn(`Message at index ${i} is invalid, skipping`);
        continue;
      }

      try {
        const from = msg.from; // sender's wa id (phone)
        const textBody = msg.text?.body;
        const msgId = msg.id;

        // Validate required fields
        if (!from || typeof from !== 'string' || from.trim() === '') {
          this.logger.warn(
            `Message at index ${i} has invalid or missing 'from' field, skipping`,
          );
          continue;
        }

        if (!msgId || typeof msgId !== 'string' || msgId.trim() === '') {
          this.logger.warn(
            `Message at index ${i} from ${from} has invalid or missing message ID, skipping`,
          );
          continue;
        }

        this.logger.log(
          `Processing inbound message - From: ${from}, Message ID: ${msgId}, Phone Number ID: ${fromPhoneNumberId || 'unknown'}, Has Text: ${!!textBody}`,
        );

        await this.handleInboundTextMessage({
          from,
          fromPhoneNumberId,
          textBody,
          wabaMessageId: msgId,
        });
      } catch (e) {
        this.logger.error(
          `Failed processing inbound message at index ${i}`,
          e instanceof Error ? e.stack : e,
        );
      }
    }
  }

  private async resolveProjectByPhoneNumberId(phoneNumberId?: string) {
    // Validate phoneNumberId
    if (!phoneNumberId) {
      this.logger.debug('resolveProjectByPhoneNumberId called without phoneNumberId');
      return null;
    }

    if (typeof phoneNumberId !== 'string' || phoneNumberId.trim() === '') {
      this.logger.warn(
        `resolveProjectByPhoneNumberId called with invalid phoneNumberId: ${phoneNumberId}`,
      );
      return null;
    }

    // Validate service exists
    if (!this.projectService) {
      this.logger.error(
        `projectService is not available. Cannot resolve project for phone number ID: ${phoneNumberId}`,
      );
      return null;
    }

    try {
      this.logger.debug(`Resolving project for phone number ID: ${phoneNumberId}`);

      const model = (this.projectService as any)['projectModel'];
      if (!model) {
        this.logger.warn(
          `projectModel is not available in projectService. Cannot resolve project for phone number ID: ${phoneNumberId}`,
        );
        return null;
      }

      if (typeof model.findOne !== 'function') {
        this.logger.error(
          `projectModel.findOne is not a function. Cannot resolve project for phone number ID: ${phoneNumberId}`,
        );
        return null;
      }

      const project = await model.findOne({ phoneNumberId }).exec();

      if (!project) {
        this.logger.debug(
          `No project found for phone number ID: ${phoneNumberId}`,
        );
        return null;
      }

      this.logger.log(
        `Successfully resolved project for phone number ID: ${phoneNumberId}, Project ID: ${project._id || 'unknown'}`,
      );

      return project;
    } catch (error) {
      this.logger.error(
        `Error resolving project for phone number ID: ${phoneNumberId}`,
        error instanceof Error ? error.stack : error,
      );
      return null;
    }
  }

  private async handleInboundTextMessage(args: {
    from: string;
    fromPhoneNumberId?: string;
    textBody?: string;
    wabaMessageId: string;
  }) {
    // Validate args object exists
    if (!args || typeof args !== 'object') {
      this.logger.error('handleInboundTextMessage called with invalid args object', {
        args,
      });
      return;
    }

    const { from, fromPhoneNumberId, textBody, wabaMessageId } = args;

    // Validate required fields
    if (!from || typeof from !== 'string' || from.trim() === '') {
      this.logger.error(
        'handleInboundTextMessage called with invalid or missing "from" field',
        { from, wabaMessageId, fromPhoneNumberId },
      );
      return;
    }

    if (!wabaMessageId || typeof wabaMessageId !== 'string' || wabaMessageId.trim() === '') {
      this.logger.error(
        `handleInboundTextMessage called with invalid or missing "wabaMessageId" field for from: ${from}`,
        { from, wabaMessageId, fromPhoneNumberId },
      );
      return;
    }

    this.logger.log(
      `Handling inbound text message - From: ${from}, Message ID: ${wabaMessageId}, Phone Number ID: ${fromPhoneNumberId || 'not provided'}`,
    );

    // Validate optional fields
    if (fromPhoneNumberId !== undefined && (typeof fromPhoneNumberId !== 'string' || fromPhoneNumberId.trim() === '')) {
      this.logger.warn(
        `Invalid fromPhoneNumberId provided for message from ${from}, message ID: ${wabaMessageId}. Continuing without phone number ID.`,
      );
    }

    // Try to resolve project via phoneNumberId; fallback skip if unknown
    const project = await this.resolveProjectByPhoneNumberId(fromPhoneNumberId);
    if (!project) {
      this.logger.warn(
        `Could not resolve project for phone number ID: ${fromPhoneNumberId || 'not provided'}, message from: ${from}, message ID: ${wabaMessageId}. Skipping message processing.`,
      );
      return;
    }

    // Validate project has required properties
    if (!project.adminId) {
      this.logger.error(
        `Project resolved but missing adminId for phone number ID: ${fromPhoneNumberId}, message from: ${from}, message ID: ${wabaMessageId}`,
      );
      return;
    }

    if (!project._id) {
      this.logger.error(
        `Project resolved but missing _id for phone number ID: ${fromPhoneNumberId}, message from: ${from}, message ID: ${wabaMessageId}`,
      );
      return;
    }

    const adminId = project.adminId as any as Types.ObjectId;
    const projectId = project._id as any as Types.ObjectId;

    // Validate gateway exists
    if (!this.whatsAppGateway) {
      this.logger.error(
        `whatsAppGateway is not available. Cannot emit message event for message from: ${from}, message ID: ${wabaMessageId}`,
      );
      return;
    }

    if (typeof this.whatsAppGateway.emitToUser !== 'function') {
      this.logger.error(
        `whatsAppGateway.emitToUser is not a function. Cannot emit message event for message from: ${from}, message ID: ${wabaMessageId}`,
      );
      return;
    }

    try {
      // Emit websocket event to admin (WhatsApp chat-message) via gateway
      this.whatsAppGateway.emitToUser(String(adminId), {
        phoneNumber: from,
        textBody: textBody || '',
        direction: 'inbound',
        createdAt: new Date().toISOString(),
      });

      this.logger.log(
        `Successfully processed inbound message - From: ${from}, Message ID: ${wabaMessageId}, Admin ID: ${adminId}, Project ID: ${projectId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to emit websocket event for inbound message - From: ${from}, Message ID: ${wabaMessageId}, Admin ID: ${adminId}`,
        error instanceof Error ? error.stack : error,
      );
    }
  }

  async getChatMessages(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    phoneNumber: string,
    page: number,
    limit: number,
  ) {
    const skip = (page - 1) * limit;
    const filter: any = {
      adminId,
      projectId,
      phoneNumber: phoneNumber.replace('+', ''),
      isDeleted: false,
    };
    const [total, messages] = await Promise.all([
      this.wabaMessageService['wabaMessageModel'].countDocuments(filter),
      this.wabaMessageService['wabaMessageModel']
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);
    return {
      messages: messages.reverse(),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async sendTextMessage(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    recipientPhoneNumber: string,
    text: string,
    contactId?: Types.ObjectId,
  ) {
    // Send via Meta Graph API using project's phoneNumberId and token
    const project = await this.projectService.findOne(adminId, projectId);
    if (!project?.phoneNumberId || !project?.permanentAccessToken) {
      throw new BadRequestException('Project WABA configuration missing');
    }

    const apiVersion = this.configService.get('GRAPH_API_VERSION') || 'v23.0';
    const url = `https://graph.facebook.com/${apiVersion}/${project.phoneNumberId}/messages`;
    const headers = {
      Authorization: `Bearer ${project.permanentAccessToken}`,
      'Content-Type': 'application/json',
    };

    const formatted = this.formatIndianRecipient(recipientPhoneNumber);
    const normalizedRecipientPhoneNumber = formatted.phoneNumber;
    const payload = {
      messaging_product: 'whatsapp',
      to: normalizedRecipientPhoneNumber,
      type: 'text',
      text: { body: text },
    };

    const response = await this.axiosInstance.post(url, payload, {
      headers,
      timeout: 15000,
    });

    const sentId = response.data?.messages?.[0]?.id || uuidv4();
    await this.wabaMessageService.create({
      projectId: String(projectId),
      adminId: String(adminId),
      phoneNumber: normalizedRecipientPhoneNumber,
      contactId: contactId ? String(contactId) : undefined,
      wabaMessageId: sentId,
      messageType: 'individual',
      templateName: '',
      status: 'sent',
      direction: 'outbound' as any,
      messageFormat: 'text',
      textBody: text,
      displayText: text,
    } as any);

    // Emit websocket event to admin via gateway
    this.whatsAppGateway.emitToUser(String(adminId), {
      phoneNumber: recipientPhoneNumber,
      textBody: text,
      direction: 'outbound',
      createdAt: new Date().toISOString(),
    });

    return { id: sentId };
  }

  /**
   * Check if direct messages can be sent (24-hour window)
   */
  async canSendDirectMessage(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    phoneNumber: string,
  ): Promise<{
    canSend: boolean;
    reason?: string;
    lastInboundMessageTime?: Date;
  }> {
    try {
      // Find the last inbound message from this phone number
      const filter = {
        projectId: new Types.ObjectId(projectId),
        phoneNumber: phoneNumber.replace('+', ''),
        direction: 'inbound' as any,
        isDeleted: false,
      };
      const lastInboundMessage = await this.wabaMessageService[
        'wabaMessageModel'
      ]
        .find(filter)
        .sort({ createdAt: -1 })
        .limit(1)
        .exec();

      if (!lastInboundMessage || lastInboundMessage.length === 0) {
        return {
          canSend: false,
          reason:
            'No previous inbound message from this contact. Use template messages to initiate conversation.',
        };
      }

      const lastMessage = lastInboundMessage[0];
      const lastMessageTime = new Date((lastMessage as any).createdAt);
      const now = new Date();
      const hoursDiff =
        (now.getTime() - lastMessageTime.getTime()) / (1000 * 60 * 60);

      if (hoursDiff > 24) {
        return {
          canSend: false,
          reason:
            '24-hour window has expired. Use template messages to continue conversation.',
          lastInboundMessageTime: lastMessageTime,
        };
      }

      return {
        canSend: true,
        lastInboundMessageTime: lastMessageTime,
      };
    } catch (error) {
      this.logger.error('Error checking 24-hour window:', error);
      return {
        canSend: false,
        reason: 'Error checking message window. Please use template messages.',
      };
    }
  }

  /**
   * Update message status for individual messages
   */
  private async updateMessageStatus(
    wabaMessageId: string,
    status: string,
    timestamp: string,
    failureReason?: string,
  ): Promise<void> {
    // Validate required parameters
    if (!wabaMessageId || typeof wabaMessageId !== 'string' || wabaMessageId.trim() === '') {
      this.logger.error(
        'updateMessageStatus called with invalid wabaMessageId',
        { wabaMessageId, status, timestamp },
      );
      return;
    }

    if (!status || typeof status !== 'string' || status.trim() === '') {
      this.logger.error(
        `updateMessageStatus called with invalid status for message ID: ${wabaMessageId}`,
        { wabaMessageId, status, timestamp },
      );
      return;
    }

    if (!timestamp || (typeof timestamp !== 'string' && typeof timestamp !== 'number')) {
      this.logger.warn(
        `updateMessageStatus called with invalid timestamp for message ID: ${wabaMessageId}, status: ${status}`,
        { wabaMessageId, status, timestamp },
      );
      // Continue processing even if timestamp is invalid
    }

    // Validate service exists
    if (!this.wabaMessageService) {
      this.logger.error(
        `wabaMessageService is not available. Cannot update status for message ID: ${wabaMessageId}`,
      );
      return;
    }

    if (typeof this.wabaMessageService.updateStatus !== 'function') {
      this.logger.error(
        `wabaMessageService.updateStatus is not a function. Cannot update status for message ID: ${wabaMessageId}`,
      );
      return;
    }

    try {
      this.logger.log(
        `Updating message status - Message ID: ${wabaMessageId}, Status: ${status}, Timestamp: ${timestamp}${failureReason ? `, Failure Reason: ${failureReason}` : ''}`,
      );

      // Update WABA message status
      await this.wabaMessageService.updateStatus(
        wabaMessageId,
        status,
        failureReason,
      );

      this.logger.log(
        `Successfully updated message status for message ID: ${wabaMessageId}, status: ${status}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update message status for message ID: ${wabaMessageId}, status: ${status}, timestamp: ${timestamp}`,
        error instanceof Error ? error.stack : error,
      );
    }
  }

  /**
   * Render display text from template components for chat display
   * @param components Template components array
   * @returns Human-readable text
   */
  private renderDisplayText(components: any[]): string {
    if (!components || components.length === 0) return '';

    const textParts: string[] = [];

    for (const component of components) {
      if (component.type === 'body' && component.parameters) {
        // Extract text from body parameters
        const bodyTexts = component.parameters
          .filter((param: any) => param.type === 'text')
          .map((param: any) => param.text)
          .join(' ');
        if (bodyTexts) textParts.push(bodyTexts);
      } else if (component.type === 'footer' && component.parameters) {
        // Extract text from footer parameters
        const footerTexts = component.parameters
          .filter((param: any) => param.type === 'text')
          .map((param: any) => param.text)
          .join(' ');
        if (footerTexts) textParts.push(footerTexts);
      }
    }

    return textParts.join(' ');
  }

  /**
   * A private, reusable method to call the external webhook.
   * It centralizes the HTTP call logic and error handling.
   * @param payload The data to be sent to the webhook.
   */
  async callExternalWebhook(payload: Record<string, any>) {
    const webhookUrl = this.configService.get<string>('EXTERNAL_WEBHOOK_URL');

    if (!webhookUrl) {
      this.logger.error(
        'EXTERNAL_WEBHOOK_URL is not defined in environment variables.',
      );
      return { success: false, error: 'Webhook URL not configured.' };
    }

    try {
      this.logger.log(`Calling external webhook at: ${webhookUrl}`);
      const response = await this.axiosInstance.post(webhookUrl, payload, {
        timeout: 15000,
        // Optional: Add headers if your webhook requires them, e.g., an auth token
        // headers: { 'Authorization': `Bearer ${some_token}` }
      });
      this.logger.log('Successfully received response from webhook.');
      return { success: true, data: response.data };
    } catch (error) {
      // --- ROBUST ERROR HANDLING ---
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status;
      const responseData = axiosError.response?.data;

      this.logger.error(
        `Failed to call external webhook. Status: ${status || 'N/A'}. Message: ${axiosError.message}`,
        responseData, // Log the response body from the error if available
      );

      return {
        success: false,
        error: 'Failed to communicate with the webhook service.',
        details: {
          status,
          message: axiosError.message,
          responseData,
        },
      };
    }
  }

  /**
   * Main public method to handle the full WABA connection flow.
   * @param code The authorization code from the frontend.
   * @param adminId The ID of the admin user initiating the connection.
   * @returns The newly created or updated WabaAccount document.
   */
  async exchangeCodeAndSaveWaba(
    code: string,
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
  ) {
    this.logger.log(`Starting WABA connection process for admin: ${adminId}`);
    try {
      const accessToken = await this.getAccessTokenFromCode(code);
      const wabaId = await this.getWabaIdFromToken(accessToken);

      const wabaDetails = await this.getWabaDetails(wabaId, accessToken);

      const phoneNumberId = wabaDetails?.phone_numbers.data[0]?.id;
      const phoneNumber =
        wabaDetails?.phone_numbers.data[0]?.display_phone_number;
      this.logger.log(`Saving connection details for WABA ID: ${wabaId}`);
      const newWabaConnection = await this.projectService.update(
        adminId,
        projectId,
        {
          permanentAccessToken: accessToken,
          wabaId: wabaId,
          phoneNumberId: phoneNumberId,
          phone: phoneNumber,
          appId: this.configService.get('META_APP_ID'),
          appSecret: this.configService.get('META_APP_SECRET'),
        },
      );

      this.logger.log(
        `Successfully connected WABA ${wabaId} for admin ${adminId}`,
      );

      if (newWabaConnection) {
        try {
          // Register the phone number with PIN
          const registrationData = await this.registerPhoneNumber(
            phoneNumberId,
            accessToken,
            '123456',
          );
          this.logger.log('Phone number registration data:', registrationData);

          // Subscribe the app to the WABA for webhook notifications
          const subscriptionData = await this.subscribeAppToWaba(
            wabaId,
            accessToken,
          );
          this.logger.log('App subscription data:', subscriptionData);

          this.logger.log(
            `Successfully completed WABA setup: registration and app subscription for WABA ${wabaId}`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to complete WABA setup for WABA ${wabaId}`,
            error.message,
          );
          // Don't throw the error here as the main connection was successful
          // The registration and subscription can be retried later
        }
      }

      return newWabaConnection;
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.error(
        `Failed to complete WABA connection process for admin ${adminId}. Error: ${axiosError.message}`,
        axiosError.response?.data, // Log the detailed error from Meta
      );
      throw new InternalServerErrorException(
        'Could not connect the WhatsApp account.',
      );
    }
  }

  /**
   * Exchanges an authorization code for a long-lived access token.
   * @param code The short-lived authorization code.
   * @returns The long-lived access token.
   */
  private async getAccessTokenFromCode(code: string): Promise<string> {
    const hardcoded = 'https://localhost:5174/whatsapp';
    const url = `https://graph.facebook.com/${this.configService.get('GRAPH_API_VERSION')}/oauth/access_token`;
    const params = {
      client_id: this.configService.get('META_APP_ID'),
      client_secret: this.configService.get('META_APP_SECRET'),
      code: code,
      redirect_uri: '',
    };

    const response = await this.axiosInstance.get<{ access_token: string }>(
      url,
      {
        params,
        timeout: 15000,
      },
    );
    return response.data.access_token;
  }

  /**
   * Generates a short-lived App Access Token for server-to-server calls.
   * This is required for certain actions like debugging a user token.
   * @returns A promise that resolves to the App Access Token.
   */
  private async getAppAccessToken(): Promise<string> {
    const url = `https://graph.facebook.com/oauth/access_token`;
    const params = {
      client_id: this.configService.get('META_APP_ID'),
      client_secret: this.configService.get('META_APP_SECRET'),
      grant_type: 'client_credentials',
    };

    try {
      const response = await this.axiosInstance.get<{ access_token: string }>(
        url,
        {
          params,
          timeout: 15000,
        },
      );
      return response.data.access_token;
    } catch (error) {
      this.logger.error(
        'Failed to generate App Access Token',
        error.response?.data,
      );
      throw new InternalServerErrorException(
        'Could not generate App Access Token.',
      );
    }
  }

  /**
   * Uses a valid access token to find the WABA ID it's authorized for.
   * @param accessToken A valid user access token.
   * @returns The WhatsApp Business Account ID.
   */
  private async getWabaIdFromToken(userAccessToken: string): Promise<string> {
    const appAccessToken = await this.getAppAccessToken();

    const url = 'https://graph.facebook.com/debug_token';
    const params = {
      input_token: userAccessToken, // The user's token you want to inspect.
      access_token: appAccessToken, // Your App Token to authorize the inspection.
    };

    const response = await this.axiosInstance.get(url, {
      params,
      timeout: 15000,
    });
    const wabaId = response.data.data.granular_scopes.find(
      (scope) => scope.scope === 'whatsapp_business_management',
    )?.target_ids[0];

    if (!wabaId) {
      throw new InternalServerErrorException(
        'Could not extract WABA ID from token. Permissions may be missing.',
      );
    }
    return wabaId;
  }

  /**
   * Fetches detailed information about a specific WABA.
   * @param wabaId The ID of the WABA.
   * @param accessToken A valid access token with permissions for that WABA.
   * @returns An object containing WABA details.
   */
  private async getWabaDetails(
    wabaId: string,
    userAccessToken: string,
  ): Promise<any> {
    const fields =
      'name,message_template_namespace,phone_numbers{id,display_phone_number,quality_rating}';

    // --- THE FIX ---
    // Let's be explicit with the API version to ensure it's correct.
    const apiVersion = this.configService.get('GRAPH_API_VERSION') || 'v23.0';

    // The URL structure for a specific object IS correct.
    // The error usually means the object ID is not considered valid at that path,
    // which can happen if the token doesn't have permission OR the API version is malformed.
    const url = `https://graph.facebook.com/${apiVersion}/${wabaId}`;

    const params = {
      fields: fields,
      access_token: userAccessToken, // Use the User's token, as it has the granted permissions
    };

    this.logger.log(`Fetching WABA details from URL: ${url}`);

    try {
      const response = await this.axiosInstance.get(url, {
        params,
        timeout: 15000,
      });
      return response.data;
    } catch (error) {
      this.logger.error(
        `Failed to get WABA details for ID ${wabaId}`,
        error.response?.data,
      );
      // Re-throw the original error to be handled by the calling function
      throw error;
    }
  }

  async getTemplatesForWaba(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    query: GetTemplatesQueryDto = {},
  ): Promise<TemplateResponseDto[]> {
    const account = await this.projectService.findOne(adminId, projectId);
    this.logger.log('account', account);
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
    const apiVersion = this.configService.get('GRAPH_API_VERSION') || 'v23.0';
    const url = `https://graph.facebook.com/${apiVersion}/${wabaId}/message_templates`;

    // Build query parameters
    const params: any = {
      access_token: permanentAccessToken,
      fields:
        query.fields ||
        'name,status,category,language,components,quality_score,rejected_reason',
    };

    // Add optional filters
    if (query.status) params.status = query.status;
    if (query.category) params.category = query.category;
    if (query.language) params.language = query.language;
    if (query.limit) params.limit = query.limit;
    if (query.name) params.name = query.name;

    this.logger.log(`Fetching templates for WABA: ${wabaId}`);

    try {
      const response = await this.axiosInstance.get(url, {
        params,
        timeout: 15000,
      });
      this.logger.log(
        `Successfully fetched ${response.data.data?.length || 0} templates for WABA ${wabaId}`,
      );

      if (
        !Array.isArray(response.data.data) ||
        response.data.data.length === 0
      ) {
        return [];
      }

      return response.data.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.error(`Failed to fetch templates for WABA ${wabaId}`, {
        status: axiosError.response?.status,
        data: axiosError.response?.data,
        message: axiosError.message,
      });
      this.logger.log('axiosError', JSON.stringify(axiosError, null, 2));

      // Provide more specific error messages
      if (axiosError.response?.status === 401) {
        throw new UnauthorizedException(
          'Invalid WhatsApp access token. Please reconfigure your WhatsApp Business Account.',
        );
      } else if (axiosError.response?.status === 403) {
        throw new ForbiddenException(
          'Access denied. Please check your WhatsApp Business Account permissions.',
        );
      } else if (axiosError.response?.status === 404) {
        throw new NotFoundException(
          'WhatsApp Business Account not found. Please check your configuration.',
        );
      }

      throw new InternalServerErrorException(
        axiosError.response?.data || 'Could not fetch templates from Meta.',
      );
    }
  }

  async createTemplateForWaba(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    createTemplateDto: CreateTemplateDto,
  ): Promise<TemplateResponseDto> {
    const account = await this.projectService.findOne(adminId, projectId);

    if (!account) {
      throw new UnauthorizedException({
        source: 'app',
        message: 'You do not have permission to access this project.',
      } as any);
    }

    // Check if WhatsApp credentials are configured
    if (!account.permanentAccessToken || !account.wabaId) {
      throw new NotFoundException({
        source: 'app',
        message:
          'WhatsApp Business Account is not configured for this project. Please configure WhatsApp credentials first.',
        code: 'WABA_NOT_CONFIGURED',
      } as any);
    }

    const { permanentAccessToken, wabaId } = account;
    const apiVersion = this.configService.get('GRAPH_API_VERSION') || 'v23.0';
    const url = `https://graph.facebook.com/${apiVersion}/${wabaId}/message_templates`;

    // Duplicate name check (case-insensitive) before creation
    try {
      const checkParams: any = {
        access_token: permanentAccessToken,
        name: createTemplateDto.name,
        limit: 1,
        fields: 'name,language,status',
      };
      const existing = await this.axiosInstance.get(url, {
        params: checkParams,
        timeout: 15000,
      });
      const list = Array.isArray(existing.data?.data) ? existing.data.data : [];
      const hasDuplicate = list.some(
        (t: any) =>
          String(t?.name || '').toLowerCase() ===
          String(createTemplateDto.name).toLowerCase(),
      );
      if (hasDuplicate) {
        throw new BadRequestException({
          source: 'app',
          message: 'A template with the same name already exists.',
          code: 'TEMPLATE_NAME_DUPLICATE',
        } as any);
      }
    } catch (err) {
      if (err instanceof BadRequestException) {
        throw err;
      }
      const axiosError = err as AxiosError;
      this.logger.error('Failed to verify existing templates before creation', {
        status: axiosError.response?.status,
        data: axiosError.response?.data,
        message: axiosError.message,
      });
      throw new InternalServerErrorException(
        'Failed to verify existing templates before creation',
      );
    }

    // Validate that BODY component exists
    const bodyComponent = createTemplateDto.components.find(
      (c) => c.type === 'BODY',
    );
    if (!bodyComponent) {
      throw new InternalServerErrorException({
        source: 'app',
        message: 'BODY component is required for all templates',
        code: 'BODY_COMPONENT_REQUIRED',
      } as any);
    }

    // Process components to handle header_handle properly
    const processedComponents = [];

    for (const component of createTemplateDto.components) {
      if (component.type === 'HEADER' && component.example) {
        // For HEADER components with media, ensure header_handle is properly formatted
        const processedComponent = { ...component };

        if (component.example.header_text) {
          // For TEXT headers, keep header_text as is
          processedComponent.example = {
            header_text: component.example.header_text,
          };
        } else if (component.example.header_handle) {
          // For media headers, ensure header_handle is an array of strings
          const headerHandles = Array.isArray(component.example.header_handle)
            ? component.example.header_handle
            : [component.example.header_handle];

          // Validate that all header handles are valid (non-empty strings)
          const validHandles = headerHandles.filter(
            (handle) =>
              handle && typeof handle === 'string' && handle.trim().length > 0,
          );

          if (validHandles.length === 0) {
            throw new BadRequestException({
              source: 'app',
              message:
                'Invalid header_handle: must contain at least one valid media handle',
              code: 'INVALID_HEADER_HANDLE',
            } as any);
          }

          // Handle generic media cases
          const processedHandles = [];
          for (const handle of validHandles) {
            if (handle === 'generic_image_handle') {
              // Upload generic image from server and get Meta handle
              const genericImageHandle = await this.getGenericMediaMetaHandle(
                adminId,
                projectId,
                'image',
              );
              processedHandles.push(genericImageHandle);
            } else if (handle === 'generic_video_handle') {
              // Upload generic video from server and get Meta handle
              const genericVideoHandle = await this.getGenericMediaMetaHandle(
                adminId,
                projectId,
                'video',
              );
              processedHandles.push(genericVideoHandle);
            } else if (handle === 'generic_document_handle') {
              // Upload generic document from server and get Meta handle
              const genericDocHandle = await this.getGenericMediaMetaHandle(
                adminId,
                projectId,
                'document',
              );
              processedHandles.push(genericDocHandle);
            } else {
              processedHandles.push(handle);
            }
          }

          processedComponent.example = {
            header_handle: processedHandles.map((handle) =>
              String(handle).trim(),
            ),
          };
        }

        processedComponents.push(processedComponent);
      } else {
        // For non-HEADER components, return as is
        processedComponents.push(component);
      }
    }

    // Build the Meta API payload according to WhatsApp Business Management API
    const metaPayload = {
      name: createTemplateDto.name,
      category: createTemplateDto.category,
      language: createTemplateDto.language,
      components: processedComponents,
      ...(createTemplateDto.parameter_format && {
        parameter_format: createTemplateDto.parameter_format,
      }),
      ...(createTemplateDto.library_template_name && {
        library_template_name: createTemplateDto.library_template_name,
      }),
      ...(createTemplateDto.library_template_button_inputs && {
        library_template_button_inputs:
          createTemplateDto.library_template_button_inputs,
      }),
    };

    this.logger.log(
      `Creating template for WABA ${wabaId}: ${JSON.stringify(metaPayload, null, 2)}`,
    );

    try {
      // CORRECTED API CALL
      this.logger.log('metaPayload', JSON.stringify(metaPayload, null, 2));
      const response = await this.axiosInstance.post(url, metaPayload, {
        headers: {
          // <-- Use headers instead of params
          Authorization: `Bearer ${permanentAccessToken}`,
        },
        timeout: 15000,
      });

      this.logger.log(
        `Template created successfully with ID: ${response.data.id}`,
      );
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      const metaData: any = axiosError.response?.data;

      this.logger.error(`Failed to create template for WABA ${wabaId}`, {
        status: axiosError.response?.status,
        data: metaData,
        message: axiosError.message,
      });

      const metaMessage =
        metaData?.error?.message ||
        (typeof metaData === 'string' ? metaData : undefined);
      const metaCode = metaData?.error?.code ?? metaData?.error?.error_subcode;

      // Provide more specific error messages while clearly tagging Meta as the source
      if (axiosError.response?.status === 401) {
        throw new UnauthorizedException({
          source: 'meta',
          message:
            'Invalid WhatsApp access token. Please reconfigure your WhatsApp Business Account.',
          code: metaCode ?? 401,
          details: metaData,
        } as any);
      } else if (axiosError.response?.status === 403) {
        throw new ForbiddenException({
          source: 'meta',
          message:
            'Access denied. Please check your WhatsApp Business Account permissions.',
          code: metaCode ?? 403,
          details: metaData,
        } as any);
      } else if (axiosError.response?.status === 400) {
        throw new BadRequestException({
          source: 'meta',
          message:
            metaMessage ||
            'Template validation failed with Meta. Please review your template content.',
          code: metaCode ?? 400,
          details: metaData,
        } as any);
      }

      throw new InternalServerErrorException({
        source: 'meta',
        message: 'Could not create template with Meta.',
        code: metaCode ?? axiosError.response?.status ?? 500,
        details: metaData,
      } as any);
    }
  }

  async updateTemplateForWaba(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    templateId: string,
    updateTemplateDto: UpdateTemplateDto,
  ): Promise<{ success: boolean }> {
    const account = await this.projectService.findOne(adminId, projectId);
    if (!account) {
      throw new UnauthorizedException(
        'You do not have permission to access this WABA.',
      );
    }

    const { permanentAccessToken } = account;
    const apiVersion = this.configService.get('GRAPH_API_VERSION') || 'v23.0';
    const url = `https://graph.facebook.com/${apiVersion}/${templateId}`;

    // Build the Meta API payload for updating
    const metaPayload: any = {};
    if (updateTemplateDto.category)
      metaPayload.category = updateTemplateDto.category;
    if (updateTemplateDto.components)
      metaPayload.components = updateTemplateDto.components;

    this.logger.log(
      `Updating template ${templateId}: ${JSON.stringify(metaPayload, null, 2)}`,
    );

    try {
      const response = await this.axiosInstance.post(url, metaPayload, {
        params: { access_token: permanentAccessToken },
        timeout: 15000,
      });

      this.logger.log(`Template ${templateId} updated successfully`);
      return response.data;
    } catch (error) {
      this.logger.error(
        `Failed to update template ${templateId}`,
        error.response?.data,
      );
      throw new InternalServerErrorException(
        error.response?.data?.error?.message || 'Could not update template.',
      );
    }
  }

  async deleteTemplateForWaba(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    deleteTemplateDto: DeleteTemplateDto,
  ): Promise<{ success: boolean }> {
    const account = await this.projectService.findOne(adminId, projectId);
    if (!account) {
      throw new UnauthorizedException(
        'You do not have permission to access this WABA.',
      );
    }

    const { permanentAccessToken, wabaId } = account;
    const apiVersion = this.configService.get('GRAPH_API_VERSION') || 'v23.0';
    const url = `https://graph.facebook.com/${apiVersion}/${wabaId}/message_templates`;

    // Build query parameters for deletion
    const params: any = {
      access_token: permanentAccessToken,
    };

    if (deleteTemplateDto.name) {
      params.name = deleteTemplateDto.name;
    }
    if (deleteTemplateDto.hsm_id) {
      params.hsm_id = deleteTemplateDto.hsm_id;
    }

    this.logger.log(
      `Deleting template: ${JSON.stringify(deleteTemplateDto, null, 2)}`,
    );

    try {
      const response = await this.axiosInstance.delete(url, {
        params,
        timeout: 15000,
      });

      this.logger.log(`Template deleted successfully`);
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to delete template`, error.response?.data);
      throw new InternalServerErrorException(
        error.response?.data?.error?.message || 'Could not delete template.',
      );
    }
  }

  async getTemplateById(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    templateId: string,
  ): Promise<TemplateResponseDto> {
    const account = await this.projectService.findOne(adminId, projectId);
    if (!account) {
      throw new UnauthorizedException(
        'You do not have permission to access this WABA.',
      );
    }

    const { permanentAccessToken } = account;
    const apiVersion = this.configService.get('GRAPH_API_VERSION') || 'v23.0';
    const url = `https://graph.facebook.com/${apiVersion}/${templateId}`;

    try {
      const response = await this.axiosInstance.get(url, {
        params: {
          access_token: permanentAccessToken,
          fields:
            'name,status,category,language,components,quality_score,rejected_reason',
        },
        timeout: 15000,
      });
      return response.data;
    } catch (error) {
      this.logger.error(
        `Failed to fetch template ${templateId}`,
        error.response?.data,
      );
      throw new InternalServerErrorException(
        'Could not fetch template from Meta.',
      );
    }
  }

  /**
   * Helper method to resolve dynamic variables for a specific contact
   */
  private async resolveVariablesForContact(
    contactId: string,
    variables: string[],
    dynamicFlags: boolean[],
  ): Promise<string[]> {
    const resolvedVariables: string[] = [];

    for (let i = 0; i < variables.length; i++) {
      const variable = variables[i];
      const isDynamic = dynamicFlags && dynamicFlags[i];

      if (isDynamic && variable.startsWith('$')) {
        // This is a dynamic variable, fetch contact data
        const contact = await this.contactsService.findById(
          new Types.ObjectId(contactId),
        );

        // Map dynamic variable to contact field
        const fieldMap: { [key: string]: string } = {
          $firstName: contact.firstName,
          $lastName: contact.lastName || '',
          $email: contact.email,
          $phone: contact.phone,
        };

        resolvedVariables.push(fieldMap[variable] || variable);
      } else {
        // Static variable, use as-is
        resolvedVariables.push(variable);
      }
    }

    return resolvedVariables;
  }

  /**
   * Unified method to send a single template message with support for dynamic variables
   */
  async sendSingleTemplateMessage(payload: {
    adminId: Types.ObjectId;
    projectId: string;
    recipientPhoneNumber: string;
    templateName: string;
    messageType: WabaMessageType;
    bodyVariables?: string[];
    headerMediaAssetId?: string;
    language?: string;
    contactId?: string;
    campaignId?: string;
    attendeeId?: Types.ObjectId;
    meetingId?: string;
    media?: { url: string; filename: string };
    apiCampaignId?: string;
    occurrenceId?: string;
  }): Promise<any> {
    const {
      adminId,
      projectId,
      meetingId,
      occurrenceId,
      recipientPhoneNumber,
      templateName,
      bodyVariables,
      headerMediaAssetId,
      language,
      contactId,
      attendeeId,
      messageType = WabaMessageType.INDIVIDUAL,
      campaignId,
      media,
      apiCampaignId,
    } = payload;

    // Normalize and validate recipient phone number per India format rules
    const formatted = this.formatIndianRecipient(recipientPhoneNumber);

    const normalizedRecipientPhoneNumber = formatted.phoneNumber;
    this.logger.log(
      `Attempting to send template '${templateName}' from WABA ${projectId} to ${normalizedRecipientPhoneNumber}`,
    );

    const account = await this.projectService.findOne(
      adminId,
      new Types.ObjectId(projectId),
    );
    if (!account) {
      throw new UnauthorizedException(
        'You do not have permission to access this WABA.',
      );
    }

    // We need the Phone Number ID from the WABA to send a message
    const fromPhoneNumberId = account.phoneNumberId;
    if (!fromPhoneNumberId) {
      throw new NotFoundException(
        'No sending phone number found for this WABA.',
      );
    }

    const apiVersion = this.configService.get('GRAPH_API_VERSION') || 'v23.0';
    const url = `https://graph.facebook.com/${apiVersion}/${fromPhoneNumberId}/messages`;

    // Resolve variables for this specific contact if dynamic variables are provided
    const resolvedVariables = bodyVariables || [];

    // Create template structure for this contact with resolved variables
    const templateStructure: any = {
      name: templateName,
      language: {
        code: language || 'en_US',
      },
      components: [],
    };

    // Add body component with resolved variables
    if (resolvedVariables.length > 0) {
      templateStructure.components.push({
        type: 'body',
        parameters: resolvedVariables.map((variable) => ({
          type: 'text',
          text: variable,
        })),
      });
    }

    // Add header component if media asset is provided
    if (headerMediaAssetId) {
      const mediaAsset =
        await this.mediaAssetModel.findById(headerMediaAssetId);
      this.logger.log('mediaAsset', mediaAsset);
      if (!mediaAsset) {
        throw new NotFoundException('Media asset not found');
      }

      // Get template details to determine header format
      const templates = await this.getTemplatesForWaba(
        adminId,
        new Types.ObjectId(projectId),
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

      if (headerComponent) {
        const headerFormat = headerComponent.format;
        let headerParameter: any;

        switch (headerFormat) {
          case 'IMAGE':
            headerParameter = {
              type: 'image',
              image: {
                link: mediaAsset.filePath,
              },
            };
            break;
          case 'VIDEO':
            headerParameter = {
              type: 'video',
              video: {
                link: mediaAsset.filePath,
              },
            };
            break;
          case 'DOCUMENT':
            headerParameter = {
              type: 'document',
              document: {
                link: mediaAsset.filePath,
                filename: mediaAsset.fileName,
              },
            };
            break;
          default:
            this.logger.log('Unsupported header format', headerFormat);
            throw new BadRequestException(
              `Unsupported header format: ${headerFormat}`,
            );
        }

        templateStructure.components.push({
          type: 'header',
          parameters: [headerParameter],
        });
      }
    } else if (media) {
      this.logger.log('mediaAsset', media);

      // Get template details to determine header format
      const templates = await this.getTemplatesForWaba(
        adminId,
        new Types.ObjectId(projectId),
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

      if (headerComponent) {
        const headerFormat = headerComponent.format;
        let headerParameter: any;

        switch (headerFormat) {
          case 'IMAGE':
            headerParameter = {
              type: 'image',
              image: {
                link: media.url,
              },
            };
            break;
          case 'VIDEO':
            headerParameter = {
              type: 'video',
              video: {
                link: media.url,
              },
            };
            break;
          case 'DOCUMENT':
            headerParameter = {
              type: 'document',
              document: {
                link: media.url,
                filename: media.filename,
              },
            };
            break;
          default:
            this.logger.log('Unsupported header format', headerFormat);
            throw new BadRequestException(
              `Unsupported header format: ${headerFormat}`,
            );
        }

        templateStructure.components.push({
          type: 'header',
          parameters: [headerParameter],
        });
      }
    }

    // Remove components if empty
    if (templateStructure.components.length === 0) {
      delete templateStructure.components;
    }

    const metaPayload = {
      messaging_product: 'whatsapp',
      to: normalizedRecipientPhoneNumber,
      type: 'template',
      template: templateStructure,
    };
    this.logger.log('metaPayload', metaPayload);

    try {
      this.logger.log(
        'formatted.digitsOnly ------------------------- > ',
        formatted.digitsOnly.length,
      );

      if (!formatted.digitsOnly)
        throw new BadRequestException('Invalid phone number');

      this.logger.log('Sending template message to Meta', metaPayload);
      const response = await this.axiosInstance.post(url, metaPayload, {
        headers: {
          Authorization: `Bearer ${account.permanentAccessToken}`,
        },
        timeout: 15000, // 15 second timeout
      });

      this.logger.log(
        `Message sent successfully to ${normalizedRecipientPhoneNumber}. Message ID: ${response.data.messages[0].id}`,
      );

      // Create WABA message record
      if (response.data?.messages[0]?.id) {
        try {
          await this.wabaMessageService.create({
            projectId: projectId,
            adminId: adminId.toString(),
            phoneNumber: normalizedRecipientPhoneNumber,
            contactId: contactId,
            wabaMessageId: response.data.messages[0].id,
            messageType,
            templateName: templateName,
            templateLanguage: language || 'en_US',
            messageFormat: 'template',
            templateComponents: templateStructure.components || [],
            displayText: this.renderDisplayText(
              templateStructure.components || [],
            ),
            campaignId,
            attendeeId: attendeeId?.toString(),
            apiCampaignId,
            meetingId,
            occurrenceId,
            direction: 'outbound' as any,
          });
        } catch (error) {
          this.logger.error('Failed to create WABA message record:', error);
          // Don't throw error here as the message was sent successfully
        }
      }

      return response.data;
    } catch (error) {
      this.createErrorMessage({
        projectId: projectId,
        adminId: adminId.toString(),
        normalizedRecipientPhoneNumber,
        contactId: contactId,
        messageType,
        templateName: templateName,
        language: language || 'en_US',
        messageFormat: 'template',
        templateStructure: templateStructure.components || [],
        campaignId,
        attendeeId: attendeeId?.toString(),
        apiCampaignId,
        meetingId,
        occurrenceId,
        error: error,
      });
      // Enhanced error handling for axios errors
      if (axios.isAxiosError(error)) {
        this.logger.error(`Axios request failed: ${error.message}`, {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          url: error.config?.url,
          method: error.config?.method,
        });

        // Provide more specific error messages based on status codes
        if (error.response?.status === 401) {
          throw new UnauthorizedException(
            'Invalid access token or expired credentials',
          );
        } else if (error.response?.status === 400) {
          throw new BadRequestException(
            error.response?.data?.error?.message ||
              'Invalid request parameters',
          );
        } else if (error.response?.status === 429) {
          throw new InternalServerErrorException(
            'Rate limit exceeded. Please try again later',
          );
        } else if (error.code === 'ETIMEDOUT') {
          throw new InternalServerErrorException(
            'Request timeout. Please try again',
          );
        }
      } else {
        this.logger.error(
          'An unexpected error occurred while sending message',
          error,
        );
      }
    }
  }

  async createErrorMessage({
    projectId,
    adminId,
    campaignId,
    normalizedRecipientPhoneNumber,
    contactId,
    templateName,
    error,
    language,
    templateStructure,
    attendeeId,
    meetingId,
    occurrenceId,
    apiCampaignId,
    messageType,
    messageFormat,
  }: {
    projectId: string;
    adminId: string;
    campaignId?: string;
    normalizedRecipientPhoneNumber: string;
    contactId?: string;
    templateName: string;
    error: any;
    language: string;
    templateStructure: any;
    attendeeId?: string;
    meetingId?: string;
    occurrenceId?: string;
    apiCampaignId?: string;
    messageType: WabaMessageType;
    messageFormat: 'text' | 'template' | 'media';
  }) {
    try {
      const wabaMessageId = uuidv4();
      await this.wabaMessageService.create({
        projectId,
        adminId,
        campaignId,
        phoneNumber: normalizedRecipientPhoneNumber,
        contactId,
        apiCampaignId,
        wabaMessageId, //
        messageType,
        templateName,
        failureReason: error.response?.data?.error || error.message,
        status: CampaignStatus.FAILED,
        direction: 'outbound' as any,

        templateLanguage: language || 'en_US',
        messageFormat,
        templateComponents: templateStructure.components || [],
        displayText: this.renderDisplayText(templateStructure.components || []),
        attendeeId,
        meetingId,
        occurrenceId,
      });
    } catch (error) {
      this.logger.error('Failed to create error message:', error);
    }
  }

  private formatIndianRecipient(input: string): IFormattedPhoneData {
    const raw = `${input || ''}`.trim();
    const digitsOnly = raw.replace(/\D/g, '');
    let candidate = '';

    if (/^0\d{10}$/.test(digitsOnly)) {
      candidate = `+91${digitsOnly.slice(1)}`;
    } else if (/^\d{10}$/.test(digitsOnly)) {
      candidate = `+91${digitsOnly}`;
    } else if (/^91\d{10}$/.test(digitsOnly)) {
      candidate = `+${digitsOnly}`;
    } else if (/^\+91\d{10}$/.test(raw)) {
      candidate = raw;
    }

    const isValid = /^\+91\d{10}$/.test(candidate);
    return { phoneNumber: isValid ? candidate : input, digitsOnly, isValid };
  }

  async checkVariableMappingLength({
    adminId,
    projectId,
    templateName,
    givenVariableLength,
    headerMediaAssetId,
  }: {
    adminId: string;
    projectId: string;
    templateName: string;
    givenVariableLength: number;
    headerMediaAssetId?: string;
  }): Promise<{
    template: WabaTemplateDocument;
  }> {
    const template = await this.wabaTemplateService.getByTemplateName(
      new Types.ObjectId(adminId),
      new Types.ObjectId(projectId),
      templateName,
    );

    if (!template) {
      throw new NotFoundException('Template not found');
    }

    // we need to check if the given variable length is equal to the template variable length
    const bodyComponent = template.components?.find(
      (component) => component.type === 'BODY' || component.type === 'body',
    );
    if (!bodyComponent) {
      throw new BadRequestException('Template body components are required');
    }

    let variableLength = 0;

    const exampleBodyText = bodyComponent?.example?.body_text?.[0];

    if (Array.isArray(exampleBodyText)) {
      variableLength = exampleBodyText.length;
    }

    if (variableLength !== givenVariableLength) {
      throw new BadRequestException(
        'Variable length is not equal to the template variable length',
      );
    }

    const headerComponent = template.components?.find(
      (c) => c.type === 'HEADER',
    );

    if (headerComponent) {
      const headerFormat = headerComponent.format;
      const mediaHeaderFormats = ['IMAGE', 'VIDEO', 'DOCUMENT'];

      if (!mediaHeaderFormats.includes(headerFormat)) {
        this.logger.log('Header format does not require media', headerFormat);
      } else {
        if (headerMediaAssetId) {
          const mediaAsset =
            await this.mediaAssetModel.findById(headerMediaAssetId);
          if (!mediaAsset) {
            throw new NotFoundException('Media asset not found');
          }
        } else {
          throw new BadRequestException(
            `Template header (${headerFormat}) requires media, but none provided`,
          );
        }
      }
    }

    return { template };
  }

  async sendBulkTemplateMessage(
    adminId: string,
    sendBulkTemplateDto: SendBulkTemplateMessageDto,
  ): Promise<any> {
    const {
      projectId,
      contacts,
      templateName,
      variableMappings = [],
      headerMediaAssetId,
      language,
    } = sendBulkTemplateDto;

    let recipients: {
      recipientPhoneNumber: string;
      contactId: string;
      bodyVariables: string[];
    }[] = [];

    await this.checkVariableMappingLength({
      adminId,
      projectId,
      templateName,
      givenVariableLength: variableMappings.length,
      headerMediaAssetId,
    });

    const contactData = await this.contactsService.getContactByIds(
      new Types.ObjectId(adminId),
      contacts.map((contact) => new Types.ObjectId(contact.contactId)),
    );

    if (!Array.isArray(contactData)) {
      throw new BadRequestException('Invalid contact IDs');
    }

    for (const contact of contactData) {
      const bodyVariables: string[] = [];
      variableMappings?.forEach((mapping) => {
        if (mapping.isDynamic) {
          if (!mapping.contactField) {
            throw new BadRequestException('Contact field is required');
          }
          const key = mapping.contactField.replace(/^\$/, ''); // remove "$" from the start
          const value = contact[key as keyof typeof contact];
          bodyVariables.push(
            value || mapping.fallbackValue || mapping.contactField,
          );
        } else {
          if (!mapping.staticValue) {
            throw new BadRequestException('Static value is required');
          }
          bodyVariables.push(mapping.staticValue);
        }
      });

      recipients.push({
        recipientPhoneNumber: contact.phone,
        contactId: contact._id.toString(),
        bodyVariables,
      });
    }

    return this.sendTemplateMessagev2({
      adminId,
      messageType: WabaMessageType.INDIVIDUAL,
      sendTemplateDto: {
        projectId,
        recipients,
        templateName,
        headerMediaAssetId,
        language,
      },
    });
  }

  async getWabaDetailsTest(): Promise<any> {
    const fields =
      'name,message_template_namespace,phone_numbers{id,display_phone_number,quality_rating}';

    // --- THE FIX ---
    // Let's be explicit with the API version to ensure it's correct.
    const apiVersion = this.configService.get('GRAPH_API_VERSION') || 'v23.0';

    // The URL structure for a specific object IS correct.
    // The error usually means the object ID is not considered valid at that path,
    // which can happen if the token doesn't have permission OR the API version is malformed.
    const url = `https://graph.facebook.com/${apiVersion}/1055988183368296`;

    const params = {
      fields: fields,
      access_token:
        'EAASkZB5UKWQ8BPeU6rwlctUSrGPEf2S73Qrfn7GXMpwxf7zo3DvPxErxfU2V6THBbih4BuDMvFdOAdLlxDtXDMZA2d4GsatZAVNB2owrqGKvtqQhH8uHMA1h2caOAXtJ13qkLS8UdZAl9IUjV5vZAijXiBtqpqwhZAz8HePCWXLbubFwo9r81YX8YiiOBKShzmsa2m', // Use the User's token, as it has the granted permissions
    };

    this.logger.log(`Fetching WABA details from URL: ${url}`);

    try {
      const response = await this.axiosInstance.get(url, {
        params,
        timeout: 15000,
      });
      return response.data;
    } catch (error) {
      this.logger.error(
        `Failed to get WABA details for ID`,
        error.response?.data,
      );
      // Re-throw the original error to be handled by the calling function
      throw error;
    }
  }

  /**
   * Registers a phone number with WhatsApp Business API using a PIN
   * @param phoneNumberId The phone number ID to register
   * @param accessToken The access token for authentication
   * @param pin The PIN code for registration (usually 6 digits)
   * @returns Promise with registration result
   */
  async registerPhoneNumber(
    phoneNumberId: string,
    accessToken: string,
    pin: string,
  ): Promise<any> {
    const apiVersion = this.configService.get('GRAPH_API_VERSION') || 'v23.0';
    const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/register`;

    const payload = {
      messaging_product: 'whatsapp',
      pin: pin,
    };

    this.logger.log(
      `Registering phone number ${phoneNumberId} with PIN: ${pin}`,
    );

    try {
      const response = await this.axiosInstance.post(url, payload, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });

      this.logger.log(`Phone number ${phoneNumberId} registered successfully`);
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.error(`Failed to register phone number ${phoneNumberId}`, {
        status: axiosError.response?.status,
        data: axiosError.response?.data,
        message: axiosError.message,
      });

      // Provide specific error messages based on status codes
      if (axiosError.response?.status === 400) {
        throw new InternalServerErrorException(
          'Invalid PIN or phone number registration data. Please check your PIN and try again.',
        );
      } else if (axiosError.response?.status === 401) {
        throw new UnauthorizedException(
          'Invalid access token. Please reconfigure your WhatsApp Business Account.',
        );
      } else if (axiosError.response?.status === 403) {
        throw new ForbiddenException(
          'Access denied. Please check your WhatsApp Business Account permissions.',
        );
      } else if (axiosError.response?.status === 404) {
        throw new NotFoundException(
          'Phone number not found. Please check your phone number ID.',
        );
      }

      throw new InternalServerErrorException(
        typeof axiosError.response?.data === 'string'
          ? axiosError.response?.data
          : 'Could not register phone number.',
      );
    }
  }

  /**
   * Registers a phone number for a specific project
   * @param adminId The admin user ID
   * @param projectId The project ID
   * @param pin The PIN code for registration
   * @returns Promise with registration result
   */
  async registerPhoneNumberForProject(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    pin: string,
  ): Promise<any> {
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

    return this.registerPhoneNumber(phoneNumberId, permanentAccessToken, pin);
  }

  /**
   * Subscribes an app to a WhatsApp Business Account for webhook notifications
   * @param wabaId The WhatsApp Business Account ID
   * @param accessToken The access token for authentication
   * @returns Promise with subscription result
   */
  async subscribeAppToWaba(wabaId: string, accessToken: string): Promise<any> {
    const apiVersion = this.configService.get('GRAPH_API_VERSION') || 'v23.0';
    const url = `https://graph.facebook.com/${apiVersion}/${wabaId}/subscribed_apps`;

    this.logger.log(`Subscribing app to WABA ${wabaId}`);

    try {
      const response = await this.axiosInstance.post(
        url,
        {},
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        },
      );

      this.logger.log(`App successfully subscribed to WABA ${wabaId}`);
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.error(`Failed to subscribe app to WABA ${wabaId}`, {
        status: axiosError.response?.status,
        data: axiosError.response?.data,
        message: axiosError.message,
      });

      // Provide specific error messages based on status codes
      if (axiosError.response?.status === 400) {
        throw new InternalServerErrorException(
          'Invalid subscription request. Please check your WABA configuration.',
        );
      } else if (axiosError.response?.status === 401) {
        throw new UnauthorizedException(
          'Invalid access token. Please reconfigure your WhatsApp Business Account.',
        );
      } else if (axiosError.response?.status === 403) {
        throw new ForbiddenException(
          'Access denied. Please check your WhatsApp Business Account permissions.',
        );
      } else if (axiosError.response?.status === 404) {
        throw new NotFoundException(
          'WhatsApp Business Account not found. Please check your WABA ID.',
        );
      }

      throw new InternalServerErrorException(
        typeof axiosError.response?.data === 'string'
          ? axiosError.response?.data
          : 'Could not subscribe app to WABA.',
      );
    }
  }

  /**
   * Subscribes an app to a WhatsApp Business Account for a specific project
   * @param adminId The admin user ID
   * @param projectId The project ID
   * @returns Promise with subscription result
   */
  async subscribeAppToWabaForProject(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
  ): Promise<any> {
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

    return this.subscribeAppToWaba(wabaId, permanentAccessToken);
  }

  async checkAppSubscriptionToWaba(
    wabaId: string,
    accessToken: string,
  ): Promise<{ isSubscribed: boolean; subscribedApps?: any[] }> {
    const apiVersion = this.configService.get('GRAPH_API_VERSION') || 'v23.0';
    const url = `https://graph.facebook.com/${apiVersion}/${wabaId}/subscribed_apps`;

    this.logger.log(`Checking subscription status for WABA ${wabaId}`);

    try {
      const response = await this.axiosInstance.get(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });

      const subscribedApps = response.data?.data || [];
      this.logger.log(`subscribedApps ${JSON.stringify(subscribedApps)}`);
      const appId = this.configService.get('META_APP_ID');
      this.logger.log(`appId ${appId}`);
      const isSubscribed = subscribedApps.some(
        (app: any) => app?.whatsapp_business_api_data?.id === appId,
      );

      this.logger.log(
        `App ${isSubscribed ? 'is' : 'is not'} subscribed to WABA ${wabaId}`,
      );

      return {
        isSubscribed,
        subscribedApps,
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.error(
        `Failed to check subscription status for WABA ${wabaId}`,
        {
          status: axiosError.response?.status,
          data: axiosError.response?.data,
          message: axiosError.message,
        },
      );

      // Handle specific error cases similar to subscribeAppToWaba
      if (axiosError.response?.status === 401) {
        throw new UnauthorizedException(
          'Invalid access token. Please reconfigure your WhatsApp Business Account.',
        );
      } else if (axiosError.response?.status === 403) {
        throw new ForbiddenException(
          'Access denied. Please check your WhatsApp Business Account permissions.',
        );
      } else if (axiosError.response?.status === 404) {
        throw new NotFoundException(
          'WhatsApp Business Account not found. Please check your WABA ID.',
        );
      }

      throw new InternalServerErrorException(
        'Could not check subscription status for WABA.',
      );
    }
  }

  async getMetaHeaderHandle(
    fileBuffer: Buffer,
    mimeType: string,
    originalName: string,
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
  ): Promise<string> {
    try {
      this.logger.log(
        `Uploading sample file to Meta using WhatsApp Media API: ${originalName}`,
      );

      const project = await this.projectService.findOne(adminId, projectId);

      // Get WABA credentials from your configuration
      const apiVersion = this.configService.get('GRAPH_API_VERSION', 'v23.0');
      const phoneNumberId = project.phoneNumberId;
      const accessToken = project.permanentAccessToken;
      const appId = project.appId;

      if (!phoneNumberId) {
        throw new InternalServerErrorException(
          'WABA Phone Number ID is not configured.',
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

      const sessionResponse = await this.axiosInstance.post(
        createSessionUrl,
        null,
        {
          params: sessionParams,
          timeout: 15000,
        },
      );

      this.logger.log(
        `Upload session created: ${JSON.stringify(sessionResponse.data, null, 2)}`,
      );

      const uploadSessionId = sessionResponse.data.id;
      if (!uploadSessionId || !uploadSessionId.startsWith('upload:')) {
        throw new Error('Invalid upload session ID received from Meta');
      }

      // Step 2: Upload the file data
      const uploadUrl = `https://graph.facebook.com/${apiVersion}/${uploadSessionId}`;

      this.logger.log(`Uploading file data to session: ${uploadSessionId}`);

      const uploadResponse = await this.axiosInstance.post(
        uploadUrl,
        fileBuffer,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            file_offset: '0',
            'Content-Type': mimeType,
          },
          timeout: 15000,
        },
      );

      this.logger.log(
        `File upload completed: ${JSON.stringify(uploadResponse.data, null, 2)}`,
      );

      const fileHandle = uploadResponse.data.h;
      if (!fileHandle) {
        throw new Error('No file handle received from Meta upload');
      }

      this.logger.log(`File uploaded successfully, handle: ${fileHandle}`);

      return fileHandle;
    } catch (error) {
      // Log the detailed error from Meta's API
      this.logger.error(
        'Meta Resumable Upload Failed. Response:',
        JSON.stringify(error.response?.data),
      );
      this.logger.error(`Failed to upload sample to Meta: ${error.message}`);
      throw new InternalServerErrorException(
        `Failed to get Meta header handle: ${error.response?.data?.error?.message || error.message}`,
      );
    }
  }

  private async getGenericMediaMetaHandle(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    mediaType: 'image' | 'video' | 'document',
  ): Promise<string> {
    try {
      // Define media file configurations
      const mediaConfig = {
        image: {
          filename: 'generic-image.png',
          mimeType: 'image/png',
          path: path.join(
            process.cwd(),
            'public',
            'generic',
            'generic-image.png',
          ),
        },
        video: {
          filename: 'generic-video.mp4',
          mimeType: 'video/mp4',
          path: path.join(
            process.cwd(),
            'public',
            'generic',
            'generic-video.mp4',
          ),
        },
        document: {
          filename: 'generic-doc.pdf',
          mimeType: 'application/pdf',
          path: path.join(
            process.cwd(),
            'public',
            'generic',
            'generic-doc.pdf',
          ),
        },
      };

      const config = mediaConfig[mediaType];

      // Check if file exists
      if (!fs.existsSync(config.path)) {
        throw new InternalServerErrorException(
          `Generic ${mediaType} file not found on server: ${config.path}`,
        );
      }

      // Read the file
      const fileBuffer = fs.readFileSync(config.path);

      this.logger.log(
        `Reading generic ${mediaType} file: ${config.filename} (${fileBuffer.length} bytes)`,
      );

      // Upload to Meta and get handle
      const metaHandle = await this.getMetaHeaderHandle(
        fileBuffer,
        config.mimeType,
        config.filename,
        adminId,
        projectId,
      );

      this.logger.log(
        `Generic ${mediaType} uploaded to Meta with handle: ${metaHandle}`,
      );
      return metaHandle;
    } catch (error) {
      this.logger.error(
        `Failed to get generic ${mediaType} Meta handle: ${error.message}`,
      );
      throw new InternalServerErrorException(
        `Failed to process generic ${mediaType}: ${error.message}`,
      );
    }
  }

  async uploadMediaAsset(
    file: Express.Multer.File,
    userId: Types.ObjectId,
    projectId: Types.ObjectId,
  ): Promise<MediaAssetDocument> {
    try {
      this.logger.log(
        `Starting media asset upload for user ${userId}, project ${projectId}`,
      );

      // Define a subfolder structure for better organization, e.g., using userId
      const subfolder = userId.toString();

      // Save the file using the new service
      const { publicUrl } = await this.fileStorageService.saveFile(
        file,
        subfolder,
      );

      if (!publicUrl) {
        throw new Error('Failed to save file to server');
      }

      // Create MediaAsset document with the new self-hosted URL
      const mediaAsset = new this.mediaAssetModel({
        userId,
        projectId,
        fileName: file.originalname,
        filePath: publicUrl, // Use the generated public URL
        fileSize: file.size,
        mimeType: file.mimetype,
      });

      const savedMediaAsset = await mediaAsset.save();

      this.logger.log(`Media asset saved successfully: ${savedMediaAsset._id}`);
      return savedMediaAsset;
    } catch (error) {
      this.logger.error(
        `Failed to upload media asset: ${error.message}`,
        error.stack,
      );
      // Avoid leaking implementation details in the error message
      throw new InternalServerErrorException(
        'A server error occurred while uploading the media asset.',
      );
    }
  }

  async getMediaAssets(
    userId: Types.ObjectId,
    projectId: Types.ObjectId,
    page: number = 1,
    limit: number = 20,
    type?: 'image' | 'video' | 'document',
  ): Promise<{
    data: MediaAssetDocument[];
    total: number;
    page: number;
    limit: number;
  }> {
    try {
      this.logger.log(
        `Fetching media assets for user ${userId}, project ${projectId}, page ${page}, limit ${limit}`,
      );

      const skip = (page - 1) * limit;

      const baseQuery: any = { userId, projectId };
      if (type === 'image') {
        baseQuery.mimeType = { $regex: '^image/' };
      } else if (type === 'video') {
        baseQuery.mimeType = { $regex: '^video/' };
      } else if (type === 'document') {
        baseQuery.mimeType = { $regex: '^application/' };
      }

      const [data, total] = await Promise.all([
        this.mediaAssetModel
          .find(baseQuery)
          .sort({ createdAt: -1 }) // Most recent first
          .skip(skip)
          .limit(limit)
          .exec(),
        this.mediaAssetModel.countDocuments(baseQuery).exec(),
      ]);

      this.logger.log(
        `Found ${data.length} media assets out of ${total} total`,
      );

      return {
        data,
        total,
        page,
        limit,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get media assets: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(
        'A server error occurred while fetching media assets.',
      );
    }
  }

  async getMediaAssetInfo(
    mediaAssetId: string | Types.ObjectId,
  ): Promise<(MediaAsset & { _id: Types.ObjectId }) | null> {
    if (!mediaAssetId) {
      return null;
    }

    let objectId: Types.ObjectId | null;

    if (mediaAssetId instanceof Types.ObjectId) {
      objectId = mediaAssetId;
    } else if (Types.ObjectId.isValid(mediaAssetId)) {
      objectId = new Types.ObjectId(mediaAssetId);
    } else {
      return null;
    }

    return this.mediaAssetModel
      .findById(objectId)
      .lean<MediaAsset & { _id: Types.ObjectId }>();
  }

  async deleteMediaAsset(
    userId: Types.ObjectId,
    projectId: Types.ObjectId,
    mediaAssetId: Types.ObjectId,
  ): Promise<MediaAssetDocument> {
    try {
      this.logger.log(
        `Deleting media asset ${mediaAssetId} for user ${userId}, project ${projectId}`,
      );

      // Find the media asset first to get file path
      const mediaAsset = await this.mediaAssetModel
        .findOne({
          _id: mediaAssetId,
          userId,
          projectId,
        })
        .exec();

      if (!mediaAsset) {
        throw new NotFoundException('Media asset not found');
      }

      // Delete the file from the server
      try {
        const fs = require('fs');
        const path = require('path');

        // Extract the file path from the URL
        const filePath = mediaAsset.filePath;
        if (filePath && fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          this.logger.log(`File deleted from server: ${filePath}`);
        }
      } catch (fileError) {
        this.logger.warn(
          `Failed to delete file from server: ${fileError.message}`,
        );
        // Continue with database deletion even if file deletion fails
      }

      // Delete from database
      const deletedMediaAsset = await this.mediaAssetModel
        .findOneAndDelete({
          _id: mediaAssetId,
          userId,
          projectId,
        })
        .exec();

      if (!deletedMediaAsset) {
        throw new NotFoundException('Media asset not found');
      }

      this.logger.log(`Media asset deleted successfully: ${mediaAssetId}`);
      return deletedMediaAsset;
    } catch (error) {
      this.logger.error(
        `Failed to delete media asset: ${error.message}`,
        error.stack,
      );
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'A server error occurred while deleting the media asset.',
      );
    }
  }

  async sendTemplateMessages(data: {
    fetchedContacts: any[];
    template: ConfiguredTemplate;
    meetingId: string;
    occurrenceId?: string;
  }) {
    const { fetchedContacts, template, meetingId, occurrenceId } = data;

    // Input validation
    if (!fetchedContacts || !Array.isArray(fetchedContacts)) {
      throw new BadRequestException('fetchedContacts must be a valid array');
    }

    if (!template) {
      throw new BadRequestException('Template is required');
    }

    if (!template.templateName) {
      throw new BadRequestException('Template name is required');
    }

    if (!template.adminId) {
      throw new BadRequestException('Template adminId is required');
    }

    if (!template.project) {
      throw new BadRequestException('Template project is required');
    }

    this.logger.log(
      `Starting to send template messages to ${fetchedContacts.length} contacts using template: ${template.templateName}`,
    );

    // Fetch template data from Meta to get the language
    let templateLanguage = 'en_US'; // Default fallback
    try {
      const metaTemplates = await this.getTemplatesForWaba(
        template.adminId,
        template.project,
        { name: template.templateName },
      );

      if (metaTemplates && metaTemplates.length > 0) {
        const metaTemplate =
          metaTemplates.find((t) => t.name === template.templateName) ||
          metaTemplates[0];
        templateLanguage = metaTemplate.language || 'en_US';
        this.logger.log(
          `Retrieved template language from Meta: ${templateLanguage} for template: ${template.templateName}`,
        );
      } else {
        this.logger.warn(
          `Template ${template.templateName} not found in Meta. Using default language: ${templateLanguage}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to fetch template language from Meta for ${template.templateName}. Using default: ${templateLanguage}`,
        error.message,
      );
    }

    const timer = MonitoringUtil.createTimer();
    const { variableMappings = [] } = template;

    // Process contacts to build recipients array with bodyVariables
    const recipients: Array<{
      recipientPhoneNumber: string;
      contactId?: string;
      bodyVariables?: string[];
    }> = [];
    const contactErrors: Array<{
      contactId: string;
      phone: string;
      error: string;
    }> = [];

    for (const contact of fetchedContacts) {
      try {
        // Validate contact data
        if (!contact) {
          this.logger.warn('Skipping null/undefined contact');
          contactErrors.push({
            contactId: 'unknown',
            phone: 'N/A',
            error: 'Null/undefined contact',
          });
          continue;
        }

        if (!contact.phone) {
          this.logger.warn(
            `Skipping contact without phone number: ${contact._id || 'unknown'}`,
          );
          contactErrors.push({
            contactId: contact._id?.toString() || 'unknown',
            phone: 'N/A',
            error: 'Missing phone number',
          });
          continue;
        }

        // Process variables with enhanced validation and sanitization
        const processedBodyVariables = variableMappings.map(
          (variable, index) => {
            try {
              const isDynamic = variable.isDynamic;
              const fallbackValue = variable.fallbackValue;

              if (isDynamic) {
                // Extract field name from variable (e.g., "$firstName" -> "firstName")
                const fieldName = variable.dynamicField?.replace('$', '');
                if (!fieldName) {
                  this.logger.warn(
                    `Invalid dynamic field for variable ${index}: ${variable.dynamicField}`,
                  );
                  return fallbackValue || '[Invalid Field]';
                }

                const contactValue = contact[fieldName];
                this.logger.debug(
                  `Processing dynamic variable ${fieldName} for contact ${contact._id}: ${contactValue}`,
                );

                // Use contact value if available and not empty, otherwise use fallback
                if (contactValue && contactValue.toString().trim() !== '') {
                  return ValidationUtil.sanitizeText(contactValue.toString());
                } else {
                  return ValidationUtil.sanitizeText(
                    fallbackValue || variable.dynamicField || '[Missing Value]',
                  );
                }
              } else {
                // Static variable, sanitize the value
                return ValidationUtil.sanitizeText(
                  variable.staticValue || '[Missing Value]',
                );
              }
            } catch (variableError) {
              this.logger.warn(
                `Error processing variable ${index}: ${variableError.message}`,
              );
              return '[Processing Error]';
            }
          },
        );

        // Build recipient object
        recipients.push({
          recipientPhoneNumber: contact.phone,
          bodyVariables:
            processedBodyVariables.length > 0
              ? processedBodyVariables
              : undefined,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : String(error || 'Unknown error');
        contactErrors.push({
          contactId: contact?._id?.toString() || 'unknown',
          phone: contact?.phone || 'N/A',
          error: errorMessage,
        });
        this.logger.error(
          `Error processing contact ${contact?._id?.toString() || 'unknown'}: ${errorMessage}`,
        );
      }
    }

    // Call sendTemplateMessagev2 with prepared recipients
    try {
      const v2Result = await this.sendTemplateMessagev2({
        adminId: template.adminId.toString(),
        messageType: WabaMessageType.ZOOM_EVENT,
        sendTemplateDto: {
          projectId: template.project.toString(),
          recipients,
          templateName: template.templateName,
          headerMediaAssetId: template.headerMediaAssetId?.toString(),
          language: templateLanguage,
        },
        meetingId,
        occurrenceId,
      });

      // Map return structure to original format
      const stats = v2Result.stats || {};
      const results = {
        total: fetchedContacts.length,
        successful: stats.enqueued || 0,
        failed:
          (stats.failed || 0) +
          (stats.duplicates || 0) +
          (stats.invalid || 0) +
          contactErrors.length,
        errors: [
          ...contactErrors,
          // Transform v2 error strings to error objects where possible
          ...(stats.errors || []).map((errorStr: string) => {
            // Try to extract contact info from error string
            const phoneMatch = errorStr.match(/^([^:]+):/);
            const phone = phoneMatch ? phoneMatch[1] : 'N/A';
            return {
              contactId: 'unknown',
              phone,
              error: errorStr,
            };
          }),
        ],
      };

      this.logger.log(
        `Template message sending completed. Results: ${results.successful}/${results.total} successful, ${results.failed} failed`,
      );

      // Log metrics
      MonitoringUtil.logMessageEventMetrics({
        eventType: 'template_message_batch',
        templateName: template.templateName,
        totalContacts: results.total,
        successfulMessages: results.successful,
        failedMessages: results.failed,
        processingTimeMs: timer(),
        timestamp: new Date(),
        errors: results.errors,
      });

      return results;
    } catch (error) {
      this.logger.error('Critical error in sendTemplateMessages:', error);

      // Return results with all contacts marked as failed
      const results = {
        total: fetchedContacts.length,
        successful: 0,
        failed: fetchedContacts.length,
        errors: [
          ...contactErrors,
          ...recipients.map((recipient) => ({
            contactId: recipient.contactId || 'unknown',
            phone: recipient.recipientPhoneNumber || 'N/A',
            error:
              error instanceof Error
                ? error.message
                : 'Failed to process batch',
          })),
        ],
      };

      // Log metrics even on failure
      MonitoringUtil.logMessageEventMetrics({
        eventType: 'template_message_batch',
        templateName: template.templateName,
        totalContacts: results.total,
        successfulMessages: results.successful,
        failedMessages: results.failed,
        processingTimeMs: timer(),
        timestamp: new Date(),
        errors: results.errors,
      });

      throw new InternalServerErrorException(
        'Failed to process template messages',
      );
    }
  }

  /**
   * Constructs a unique job ID for template sending.
   *
   * Strategy:
   * Uses UUID to ensure every job is unique, allowing multiple identical messages
   * to be sent to the same user immediately if requested.
   *
   * @param payload - The message payload
   * @returns A unique string ID
   */
  private buildTemplateJobId(payload: ISendSingleTemplateMessagePayload) {
    return `waba_${payload.fromPhoneNumberId}_${payload.formattedPhoneData?.phoneNumber}_${payload.templateName}_${uuidv4()}`;
  }

  /**
   * Enqueues a template send job into the Redis-backed BullMQ queue.
   *
   * Features:
   * - Deduplication via custom Job ID (prevent duplicates in 5m window)
   * - Configurable retries (default 3) and exponential backoff
   * - Job retention settings (keep completed for 1h, keep failed for inspection)
   * - Rate limiting is enforced by the worker consuming this queue
   *
   * @param payload - The full payload required to send the message
   * @param options - Optional overrides for jobId or retention
   * @returns Object containing success status, jobId, and queue name
   */
  /**
   * Enqueue a template send job with deduplication and sensible defaults.
   * This handles the "Producer" role in the queue architecture.
   */
  async enqueueTemplateSendJob(
    payload: ISendSingleTemplateMessagePayload,
    options?: {
      jobId?: string;
      removeOnCompleteAgeSeconds?: number;
    },
  ) {
    // 1. Determine Job ID
    // Use provided ID or generate a time-bucketed idempotent ID (default)
    // This prevents duplicate sends within the bucket window (e.g., 5 mins)
    const jobId = options?.jobId || this.buildTemplateJobId(payload);

    // 2. Configure Retention
    // How long to keep completed jobs in Redis (default 1 hour)
    // Failed jobs are kept indefinitely (removeOnFail: false) for manual inspection
    const removeOnCompleteAgeSeconds =
      options?.removeOnCompleteAgeSeconds || 3600;

    // 3. Configure Backoff Strategy
    // If the job fails (e.g., Rate Limit, Network Error), wait before retrying.
    // Exponential: 2s -> 4s -> 8s ...
    const backoff = {
      type: 'exponential',
      delay:
        this.configService.get<number>('WHATSAPP_QUEUE_BACKOFF_MS') || 2000,
    } as const;

    // 4. Configure Retry Attempts
    // Maximum number of times to try processing this job before failing permanently
    const attempts =
      this.configService.get<number>('WHATSAPP_QUEUE_ATTEMPTS') || 1;

    // 5. Add to BullMQ Queue
    // Pushes the job to Redis. The 'send-template' is the job name.
    const job = await this.whatsappTemplateQueue.add('send-template', payload, {
      jobId, // Idempotency key
      attempts, // Max retries
      backoff, // Retry delay strategy
      removeOnComplete: { age: removeOnCompleteAgeSeconds }, // Auto-cleanup success
      removeOnFail: false, // Keep failures for debugging
    });

    // 6. Return Job Details
    // Return success immediately (async). The status can be tracked via jobId.
    return {
      success: true,
      jobId: job.id,
      queue: WHATSAPP_TEMPLATE_QUEUE_NAME,
    };
  }

  /**
   * Core logic to send a single template message via Meta Graph API.
   * This method is typically called by the Queue Worker, but can be called directly.
   *
   * Flow:
   * 1. Validates all inputs (Project, Phone, Template Structure, Token)
   * 2. Normalizes phone number to Indian format (+91...)
   * 3. Constructs the Meta Graph API payload
   * 4. Sends HTTP POST to Meta
   * 5. Logs success/failure securely (scrubbing sensitive tokens)
   * 6. Creates a WABA Message record in DB for tracking
   * 7. Handles specific Axios errors (401, 403, 429, etc.) with structured responses
   *
   * @param payload - All data needed to send the message
   * @returns Structured success/error response (never throws)
   */
  async optimizedSendSingleTemplateMessage(
    payload: ISendSingleTemplateMessagePayload,
  ): Promise<any> {
    const {
      projectId,
      formattedPhoneData,
      templateName,
      templateStructure,
      language,
      fromPhoneNumberId,
      permanentAccessToken,
      adminId,
    } = payload;

    // Helper to build consistent error responses
    const buildErrorResponse = (
      code: string,
      message: string,
      details?: any,
    ) => {
      this.logger.warn(
        `optimizedSendSingleTemplateMessage failed: ${message}`,
        {
          code,
          details,
        },
      );
      return { success: false, code, message, details };
    };

    // Input validation - return structured errors instead of throwing
    if (!projectId) {
      return buildErrorResponse('VALIDATION_ERROR', 'Project ID is required');
    }
    if (!formattedPhoneData) {
      return buildErrorResponse(
        'VALIDATION_ERROR',
        'Recipient phone number is required',
      );
    }
    if (!templateName) {
      return buildErrorResponse(
        'VALIDATION_ERROR',
        'Template name is required',
      );
    }
    if (!templateStructure) {
      return buildErrorResponse(
        'VALIDATION_ERROR',
        'Template structure is required',
      );
    }
    if (!fromPhoneNumberId) {
      return buildErrorResponse(
        'VALIDATION_ERROR',
        'From phone number ID is required',
      );
    }
    if (!permanentAccessToken) {
      return buildErrorResponse(
        'VALIDATION_ERROR',
        'Permanent access token is required',
      );
    }
    if (!adminId) {
      return buildErrorResponse('VALIDATION_ERROR', 'Admin ID is required');
    }

    // Validate template structure consistency
    if (!templateStructure.name) {
      return buildErrorResponse(
        'VALIDATION_ERROR',
        'Template structure must have a name property',
      );
    }
    if (templateStructure.name !== templateName) {
      return buildErrorResponse(
        'VALIDATION_ERROR',
        `Template structure name '${templateStructure.name}' does not match template name '${templateName}'`,
      );
    }
    if (!templateStructure.language && !language) {
      return buildErrorResponse(
        'VALIDATION_ERROR',
        'Template language is required in template structure or language parameter',
      );
    }

    // Normalize and validate recipient phone number per India format rules

    const normalizedRecipientPhoneNumber = formattedPhoneData.phoneNumber;
    this.logger.log(
      `Attempting to send template '${templateName}' from WABA ${projectId} to ${normalizedRecipientPhoneNumber}`,
    );

    const apiVersion = this.configService.get('GRAPH_API_VERSION') || 'v23.0';
    const url = `https://graph.facebook.com/${apiVersion}/${fromPhoneNumberId}/messages`;

    const metaPayload = {
      messaging_product: 'whatsapp',
      to: normalizedRecipientPhoneNumber,
      type: 'template',
      template: templateStructure,
    };

    // Log payload without sensitive data
    this.logger.log('Sending template message to Meta', {
      to: normalizedRecipientPhoneNumber,
      templateName: templateStructure.name,
      templateLanguage: templateStructure.language || language,
      url,
      metaPayload,
    });

    try {
      if (!formattedPhoneData.digitsOnly)
        throw new BadRequestException('Invalid phone number');

      const response = await this.axiosInstance.post(url, metaPayload, {
        headers: {
          Authorization: `Bearer ${permanentAccessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000, // 15 second timeout
      });

      // Validate response structure
      if (!response?.data) {
        return buildErrorResponse(
          'META_RESPONSE_ERROR',
          'Invalid response from Meta API: missing data',
        );
      }

      if (!response.data.messages || !Array.isArray(response.data.messages)) {
        return buildErrorResponse(
          'META_RESPONSE_ERROR',
          'Invalid response from Meta API: missing messages array',
        );
      }

      if (response.data.messages.length === 0) {
        return buildErrorResponse(
          'META_RESPONSE_ERROR',
          'Invalid response from Meta API: empty messages array',
        );
      }

      const messageId = response.data.messages[0]?.id;
      if (!messageId) {
        return buildErrorResponse(
          'META_RESPONSE_ERROR',
          'Invalid response from Meta API: missing message ID',
        );
      }

      this.logger.log(
        `Message sent successfully to ${normalizedRecipientPhoneNumber}. Message ID: ${messageId}`,
      );

      // Create WABA message record with proper error handling
      if (messageId) {
        this.logger.log('Attempting to create WABA message record', {
          messageId,
          phoneNumber: normalizedRecipientPhoneNumber,
          projectId,
          adminId,
          templateName,
          messageType: payload.messageType,
        });
        try {
          await this.wabaMessageService.create({
            projectId,
            adminId,
            phoneNumber: normalizedRecipientPhoneNumber,
            wabaMessageId: messageId,
            messageType: payload.messageType,
            templateName,
            campaignId: payload.campaignId,
            contactId: payload.contactId,
            apiCampaignId: payload.apiCampaignId,
            attendeeId: payload.attendeeId,
            meetingId: payload.meetingId,
            occurrenceId: payload.occurrenceId,
            templateLanguage: language || templateStructure.language || 'en_US',
            messageFormat: 'template',
            templateComponents: templateStructure.components || [],
            displayText: this.renderDisplayText(
              templateStructure.components || [],
            ),
            direction: 'outbound',
          });
          this.logger.log('WABA message record created successfully', {
            messageId,
            phoneNumber: normalizedRecipientPhoneNumber,
            projectId,
            adminId,
            templateName,
            messageType: payload.messageType,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : undefined;
          this.logger.error('Failed to create WABA message record', {
            error: errorMessage,
            stack: errorStack,
            errorType: error?.constructor?.name || typeof error,
            messageId,
            phoneNumber: normalizedRecipientPhoneNumber,
            templateName,
            projectId,
            adminId,
            messageType: payload.messageType,
            campaignId: payload.campaignId,
            contactId: payload.contactId,
            attendeeId: payload.attendeeId,
            meetingId: payload.meetingId,
            occurrenceId: payload.occurrenceId,
            apiCampaignId: payload.apiCampaignId,
          });
          // Don't throw error here as the message was sent successfully
          // This is a non-critical operation
        }
      } else {
        this.logger.warn('Skipping WABA message record creation: messageId is missing', {
          phoneNumber: normalizedRecipientPhoneNumber,
          projectId,
          adminId,
          templateName,
        });
      }

      return { success: true, data: response.data, messageId };
    } catch (error) {
      // Handle error message creation with proper error handling
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      this.logger.error('Failed to send template message to Meta API', {
        error: errorMessage,
        stack: errorStack,
        errorType: error?.constructor?.name || typeof error,
        phoneNumber: normalizedRecipientPhoneNumber,
        projectId,
        adminId,
        templateName,
        messageType: payload.messageType,
        campaignId: payload.campaignId,
        contactId: payload.contactId,
        attendeeId: payload.attendeeId,
        meetingId: payload.meetingId,
        occurrenceId: payload.occurrenceId,
        apiCampaignId: payload.apiCampaignId,
      });

      try {
        this.logger.log('Attempting to create error message record', {
          phoneNumber: normalizedRecipientPhoneNumber,
          projectId,
          adminId,
          templateName,
        });
        await this.createErrorMessage({
          projectId,
          adminId,
          normalizedRecipientPhoneNumber,
          contactId: payload.contactId,
          templateName,
          error,
          language: language || 'en_US',
          templateStructure: templateStructure.components || [],
          campaignId: payload.campaignId,
          attendeeId: payload.attendeeId,
          meetingId: payload.meetingId,
          occurrenceId: payload.occurrenceId,
          apiCampaignId: payload.apiCampaignId,
          messageType: payload.messageType,
          messageFormat: 'template',
        });
        this.logger.log('Error message record created successfully', {
          phoneNumber: normalizedRecipientPhoneNumber,
          projectId,
          adminId,
          templateName,
        });
      } catch (errorLogError) {
        const logError = errorLogError instanceof Error ? errorLogError.message : String(errorLogError);
        const logErrorStack = errorLogError instanceof Error ? errorLogError.stack : undefined;
        this.logger.error('Failed to create error message record', {
          error: logError,
          stack: logErrorStack,
          errorType: errorLogError?.constructor?.name || typeof errorLogError,
          phoneNumber: normalizedRecipientPhoneNumber,
          templateName,
          projectId,
          adminId,
          originalError: errorMessage,
        });
        // Continue with error handling even if logging fails
      }

      // Enhanced error handling for axios errors
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const errorData = error.response?.data;
        const errorMessage =
          errorData?.error?.message || error.message || 'Unknown error';

        this.logger.error(`Axios request failed: ${error.message}`, {
          status,
          statusText: error.response?.statusText,
          errorMessage,
          url: error.config?.url,
          method: error.config?.method,
          // Don't log full error data to avoid sensitive info
        });

        // Provide more specific error messages based on status codes
        if (status === 401) {
          return buildErrorResponse(
            'AUTH_ERROR',
            'Invalid access token or expired credentials',
          );
        } else if (status === 400) {
          return buildErrorResponse('BAD_REQUEST', errorMessage);
        } else if (status === 403) {
          return buildErrorResponse(
            'FORBIDDEN',
            errorMessage || 'Access forbidden. Check permissions.',
          );
        } else if (status === 404) {
          return buildErrorResponse(
            'NOT_FOUND',
            errorMessage || 'Resource not found. Check phone number ID.',
          );
        } else if (status === 429) {
          return buildErrorResponse(
            'RATE_LIMIT',
            'Rate limit exceeded. Please try again later',
          );
        } else if (status === 500 || status === 502 || status === 503) {
          return buildErrorResponse(
            'META_SERVER_ERROR',
            `Meta API server error (${status}). Please try again later`,
          );
        } else if (
          error.code === 'ETIMEDOUT' ||
          error.code === 'ECONNABORTED'
        ) {
          return buildErrorResponse(
            'TIMEOUT',
            'Request timeout. Please try again',
          );
        } else if (
          error.code === 'ECONNREFUSED' ||
          error.code === 'ENOTFOUND'
        ) {
          return buildErrorResponse(
            'NETWORK_ERROR',
            'Network error. Unable to connect to Meta API',
          );
        } else if (error.code === 'ECONNRESET') {
          return buildErrorResponse(
            'NETWORK_ERROR',
            'Connection reset. Please try again',
          );
        }
        // If we don't have a specific handler, return generic axios error
        return buildErrorResponse(
          'META_ERROR',
          `Failed to send message: ${errorMessage}`,
        );
      }

      // Handle unexpected errors without throwing
      this.logger.error('An unexpected error occurred while sending message', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return buildErrorResponse(
        'UNEXPECTED_ERROR',
        'An unexpected error occurred while sending the message',
      );
    }
  }

  /**
   * High-level method to prepare and enqueue a template message.
   *
   * Responsibilities:
   * 1. Fetches Project/WABA details to get credentials (token, phone ID).
   * 2. Resolves the Template from DB to validate structure and headers.
   * 3. Constructs the final `templateStructure` with body params and media headers.
   * 4. Delegates actual sending to the Queue via `enqueueTemplateSendJob`.
   *
   * @param payload - High level inputs: recipient, template name, variables, media
   * @returns Queue job details { success, jobId, queue }
   */
  async sendTemplateMessagev2(payload: {
    adminId: string;
    messageType: WabaMessageType;
    sendTemplateDto: {
      projectId: string;
      recipients: {
        recipientPhoneNumber: string;
        contactId?: string;
        bodyVariables?: string[];
      }[];
      templateName: string;
      headerMediaAssetId?: string;
      language?: string;
    };
    media?: { url: string; filename: string };
    meetingId?: string;
    occurrenceId?: string;
    campaignId?: string;
    attendeeId?: string;
    apiCampaignId?: string;



  }): Promise<any> {
    const {
      adminId,
      sendTemplateDto,
      messageType,
      media,
      meetingId,
      occurrenceId,
      campaignId,
      attendeeId,
      apiCampaignId,
    } = payload;

    const { projectId, recipients, templateName, headerMediaAssetId } =
      sendTemplateDto;

    const account = await this.projectService.findOne(
      new Types.ObjectId(adminId),
      new Types.ObjectId(projectId),
    );
    if (!account) {
      throw new UnauthorizedException(
        'You do not have permission to access this WABA.',
      );
    }
    const fromPhoneNumberId = account.phoneNumberId;
    const permanentAccessToken = account.permanentAccessToken;

    // Fetch template once to determine header requirements
    const template = await this.wabaTemplateService.getByTemplateName(
      new Types.ObjectId(adminId),
      new Types.ObjectId(projectId),
      templateName,
    );
    if (!template) {
      throw new NotFoundException(`Template '${templateName}' not found`);
    }
    const headerComponent = template.components?.find(
      (c) => c.type === 'HEADER',
    );

    // Build base template structure (shared across all recipients)
    const baseTemplateStructure: any = {
      name: templateName,
      language: {
        code: template.language,
      },
      components: [],
    };

    // Add header component if template requires media header (shared for all recipients)
    if (headerComponent) {
      const headerFormat = headerComponent.format;
      const mediaHeaderFormats = ['IMAGE', 'VIDEO', 'DOCUMENT'];

      if (!mediaHeaderFormats.includes(headerFormat)) {
        this.logger.log('Header format does not require media', headerFormat);
      } else {
        // Resolve media source based on priority: assetId -> direct media -> error
        let mediaSource: { link: string; filename?: string } | undefined;

        if (headerMediaAssetId) {
          const mediaAsset =
            await this.mediaAssetModel.findById(headerMediaAssetId);
          this.logger.log('mediaAsset', mediaAsset);
          if (!mediaAsset) {
            throw new NotFoundException('Media asset not found');
          }
          mediaSource = {
            link: mediaAsset.filePath,
            filename: mediaAsset.fileName,
          };
        } else if (media) {
          this.logger.log('mediaAsset', media);
          mediaSource = {
            link: media.url,
            filename: media.filename,
          };
        } else {
          throw new BadRequestException(
            `Template header (${headerFormat}) requires media, but none provided`,
          );
        }

        let headerParameter: any;
        switch (headerFormat) {
          case 'IMAGE':
            headerParameter = {
              type: 'image',
              image: {
                link: mediaSource.link,
              },
            };
            break;
          case 'VIDEO':
            headerParameter = {
              type: 'video',
              video: {
                link: mediaSource.link,
              },
            };
            break;
          case 'DOCUMENT':
            headerParameter = {
              type: 'document',
              document: {
                link: mediaSource.link,
                filename: mediaSource.filename,
              },
            };
            break;
          default:
            this.logger.log('Unsupported header format', headerFormat);
            throw new BadRequestException(
              `Unsupported header format: ${headerFormat}`,
            );
        }

        baseTemplateStructure.components.push({
          type: 'header',
          parameters: [headerParameter],
        });
      }
    }

    // Helper function to build template structure per recipient with their body variables
    const buildTemplateStructureForRecipient = (
      bodyVariables?: string[],
    ): any => {
      const templateStructure = JSON.parse(
        JSON.stringify(baseTemplateStructure),
      );

      // Add body component with recipient-specific variables
      if (bodyVariables && bodyVariables.length > 0) {
        templateStructure.components.push({
          type: 'body',
          parameters: bodyVariables.map((variable) => ({
            type: 'text',
            text: variable,
          })),
        });
      }

      // Remove components if empty
      if (templateStructure.components.length === 0) {
        delete templateStructure.components;
      }

      return templateStructure;
    };

    const uniquePhoneNumbers = new Set<string>();
    const results = {
      total: recipients.length,
      enqueued: 0,
      failed: 0,
      duplicates: 0,
      invalid: 0,
      errors: [] as string[],
    };

    // Process recipients in chunks to optimize enqueueing speed while managing memory/load
    const CHUNK_SIZE = 50;
    for (let i = 0; i < recipients.length; i += CHUNK_SIZE) {
      const chunk = recipients.slice(i, i + CHUNK_SIZE);

      await Promise.all(
        chunk.map(async (recipient) => {
          try {
            const { recipientPhoneNumber, contactId, bodyVariables } =
              recipient;
            const formatted = this.formatIndianRecipient(recipientPhoneNumber);

            if (!formatted.isValid) {
              results.invalid++;
              results.errors.push(
                `${recipientPhoneNumber}: Invalid phone format`,
              );
              return;
            }

            if (uniquePhoneNumbers.has(formatted.phoneNumber)) {
              results.duplicates++;
              return;
            }
            uniquePhoneNumbers.add(formatted.phoneNumber);

            // Build template structure with recipient-specific body variables
            const templateStructure =
              buildTemplateStructureForRecipient(bodyVariables);

            await this.enqueueTemplateSendJob({
              adminId,
              projectId,
              formattedPhoneData: formatted,
              templateName,
              language: template.language,
              fromPhoneNumberId,
              permanentAccessToken,
              messageType,
              templateStructure,
              contactId,
              meetingId,
              occurrenceId,
              campaignId,
              attendeeId,
              apiCampaignId,
            });
            results.enqueued++;
          } catch (error) {
            results.failed++;
            const msg =
              error instanceof Error ? error.message : String(error || '');
            results.errors.push(
              `${recipient.recipientPhoneNumber}: Enqueue failed - ${msg}`,
            );
            this.logger.error(`Failed to enqueue message for recipient`, error);
          }
        }),
      );
    }

    this.logger.log(' Send Template Message Stats: ', results);

    return {
      success: true,
      message: `Processing completed. Enqueued: ${results.enqueued}, Duplicates: ${results.duplicates}, Invalid: ${results.invalid}, Failed: ${results.failed}`,
      stats: results,
    };
  }
}
