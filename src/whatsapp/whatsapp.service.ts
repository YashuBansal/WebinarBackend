import { HttpService } from '@nestjs/axios';
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
import { firstValueFrom, lastValueFrom, map } from 'rxjs';
import { UsersService } from 'src/users/users.service';
import { AxiosError } from 'axios';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
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
} from './dto/msg.dto';
import { v2 as cloudinary } from 'cloudinary';
import { MediaAsset, MediaAssetDocument } from './schemas/media-asset.schema';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';
import { ContactsService } from 'src/contacts/contacts.service';
import { FileStorageService } from 'src/file-storage/file-storage.service';
import { ConfiguredTemplate } from 'src/configured-templates/schema/configured-template.schema';
import { WabaMessageType } from 'src/schemas/whatsapp-embed/waba-message.schema';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly webhookVerifyToken: string;
  private readonly ENCRYPTION_KEY: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
    private readonly projectService: ProjectsService,
    @InjectModel(MediaAsset.name)
    private readonly mediaAssetModel: Model<MediaAssetDocument>,
    private readonly contactsService: ContactsService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly wabaMessageService: WabaMessageService,
    private readonly fileStorageService: FileStorageService,
  ) {
    this.webhookVerifyToken = this.configService.get<string>(
      'META_WEBHOOK_VERIFY_TOKEN',
    );
    const key = this.configService.get<string>('ENCRYPTION_KEY');
    console.log('encyption key ============ >>', key);
    // Check if the encryption key is configured.
    if (!key || key.length !== 32) {
      throw new Error(
        'ENCRYPTION_KEY is not defined or is not 32 characters long in .env file',
      );
    }

    this.ENCRYPTION_KEY = key;

    // Configure Cloudinary
    cloudinary.config({
      cloud_name: this.configService.get<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: this.configService.get<string>('CLOUDINARY_API_KEY'),
      api_secret: this.configService.get<string>('CLOUDINARY_API_SECRET'),
    });

    console.log(
      'cloudinary config',
      this.configService.get<string>('CLOUDINARY_CLOUD_NAME'),
      this.configService.get<string>('CLOUDINARY_API_KEY'),
      this.configService.get<string>('CLOUDINARY_API_SECRET'),
    );
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
      console.log('Webhook token verified successfully.');
      return;
    } else {
      // If they don't match, throw an error. Meta will see this as a failed verification.
      throw new ForbiddenException(
        'Webhook verification failed: Invalid token or mode.',
      );
    }
  }

  /**
   * Processes the incoming data payload from Meta.
   * This method will be expanded to handle message statuses, new messages, etc.
   * @param payload The body of the POST request from Meta's webhook.
   */
  async processWebhookPayload(payload: any): Promise<void> {
    console.log(JSON.stringify(payload, null, 2));
    this.logger.log('Processing webhook payload for WhatsApp messages');


    try {
      // Process status updates
      if (payload.entry?.[0]?.changes?.[0]?.value?.statuses) {
        const statuses = payload.entry[0].changes[0].value.statuses;

        for (const status of statuses) {
          // Process status updates asynchronously to avoid blocking the webhook response
          this.updateMessageStatus(
            status.id,
            status.status,
            status.timestamp,
            status.errors?.[0]?.message,
          ).catch((error) => {
            this.logger.error(
              `Failed to process status update for ${status.id}:`,
              error,
            );
          });
        }
      }

      // Process incoming messages
      if (payload.entry?.[0]?.changes?.[0]?.value?.messages) {
        const value = payload.entry[0].changes[0].value;
        const messages = value.messages;
        const contacts = value.contacts || [];
        const metadata = value.metadata || {};
        const fromPhoneNumberId = metadata?.phone_number_id;
        this.logger.log(`Received ${messages.length} incoming messages`);

        for (const msg of messages) {
          try {
            const from = msg.from; // sender's wa id (phone)
            const textBody = msg.text?.body;
            const msgId = msg.id;

            if (!from || !msgId) continue;

            await this.handleInboundTextMessage({
              from,
              fromPhoneNumberId,
              textBody,
              wabaMessageId: msgId,
            });
          } catch (e) {
            this.logger.error('Failed processing inbound message', e);
          }
        }
      }
    } catch (error) {
      this.logger.error('Error processing webhook payload', error);
    }
  }

  private async resolveProjectByPhoneNumberId(phoneNumberId?: string) {
    if (!phoneNumberId) return null;
    try {
      const model = (this.projectService as any)['projectModel'];
      if (!model) return null;
      const project = await model.findOne({ phoneNumberId }).exec();
      return project || null;
    } catch {
      return null;
    }
  }

  private async handleInboundTextMessage(args: {
    from: string;
    fromPhoneNumberId?: string;
    textBody?: string;
    wabaMessageId: string;
  }) {
    const { from, fromPhoneNumberId, textBody, wabaMessageId } = args;

    // Try to resolve project via phoneNumberId; fallback skip if unknown
    const project = await this.resolveProjectByPhoneNumberId(fromPhoneNumberId);
    if (!project) return;

    const adminId = project.adminId as any as Types.ObjectId;
    const projectId = project._id as any as Types.ObjectId;

    await this.wabaMessageService.create({
      projectId: String(projectId),
      adminId: String(adminId),
      phoneNumber: from,
      wabaMessageId,
      messageType: 'individual',
      templateName: '',
      status: 'delivered',
      direction: 'inbound' as any,
      messageFormat: 'text',
      textBody,
      displayText: textBody,
    } as any);

    // Optionally emit websocket event to admin
    try {
      const { WebsocketGateway } = await import('../websocket/websocket.gateway');
      const { SocketEvents } = await import('../websocket/dto/socket.dto');
      const gateway = (global as any).app?.get?.(WebsocketGateway);
      if (gateway?.emitSocketEvent) {
        gateway.emitSocketEvent(String(adminId), SocketEvents.CHAT_MESSAGE, {
          phoneNumber: from,
          textBody,
          wabaMessageId,
          direction: 'inbound',
          projectId,
          createdAt: new Date().toISOString(),
        });
      }
    } catch (e) {
      this.logger.warn('Websocket emit failed (non-blocking)');
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
    console.log('filter', filter);
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
    const payload = {
      messaging_product: 'whatsapp',
      to: recipientPhoneNumber,
      type: 'text',
      text: { body: text },
    };

    const response = await lastValueFrom(
      this.httpService.post(url, payload, { headers }).pipe(map((r) => r.data)),
    );

    const sentId = response?.messages?.[0]?.id || uuidv4();
    await this.wabaMessageService.create({
      projectId: String(projectId),
      adminId: String(adminId),
      phoneNumber: recipientPhoneNumber,
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

    // Emit websocket event to admin
    try {
      const { WebsocketGateway } = await import('../websocket/websocket.gateway');
      const { SocketEvents } = await import('../websocket/dto/socket.dto');
      const gateway = (global as any).app?.get?.(WebsocketGateway);
      if (gateway?.emitSocketEvent) {
        gateway.emitSocketEvent(String(adminId), SocketEvents.CHAT_MESSAGE, {
          phoneNumber: recipientPhoneNumber,
          textBody: text,
          wabaMessageId: sentId,
          direction: 'outbound',
          projectId,
          createdAt: new Date().toISOString(),
        });
      }
    } catch {}

    return { id: sentId };
  }

  /**
   * Check if direct messages can be sent (24-hour window)
   */
  async canSendDirectMessage(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    phoneNumber: string,
  ): Promise<{ canSend: boolean; reason?: string; lastInboundMessageTime?: Date }> {
    try {
      // Find the last inbound message from this phone number
      const filter = {
        projectId: new Types.ObjectId(projectId),
        phoneNumber: phoneNumber.replace('+', ''),
        direction: 'inbound' as any,
        isDeleted: false,
      };
      const lastInboundMessage = await this.wabaMessageService['wabaMessageModel']
        .find(filter)
        .sort({ createdAt: -1 })
        .limit(1)
        .exec();

      if (!lastInboundMessage || lastInboundMessage.length === 0) {
        return {
          canSend: false,
          reason: 'No previous inbound message from this contact. Use template messages to initiate conversation.',
        };
      }

      const lastMessage = lastInboundMessage[0];
      const lastMessageTime = new Date((lastMessage as any).createdAt);
      const now = new Date();
      const hoursDiff = (now.getTime() - lastMessageTime.getTime()) / (1000 * 60 * 60);

      if (hoursDiff > 24) {
        return {
          canSend: false,
          reason: '24-hour window has expired. Use template messages to continue conversation.',
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
    try {
      // Update WABA message status
      await this.wabaMessageService.updateStatus(
        wabaMessageId,
        status,
        failureReason,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update message status for ${wabaMessageId}`,
        error,
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
    console.log(payload);
    const webhookUrl = this.configService.get<string>('EXTERNAL_WEBHOOK_URL');

    if (!webhookUrl) {
      this.logger.error(
        'EXTERNAL_WEBHOOK_URL is not defined in environment variables.',
      );
      return { success: false, error: 'Webhook URL not configured.' };
    }

    try {
      this.logger.log(`Calling external webhook at: ${webhookUrl}`);
      const result = await lastValueFrom(
        this.httpService
          .post(webhookUrl, payload, {
            // Optional: Add headers if your webhook requires them, e.g., an auth token
            // headers: { 'Authorization': `Bearer ${some_token}` }
          })
          .pipe(map((resp) => resp.data)),
      );
      this.logger.log('Successfully received response from webhook.');
      return { success: true, data: result };
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
      console.log('accesstoken', accessToken);
      const wabaId = await this.getWabaIdFromToken(accessToken);
      console.log('wabaId', wabaId);

      const wabaDetails = await this.getWabaDetails(wabaId, accessToken);
      console.log(
        'waba details',
        wabaDetails?.phone_numbers.data[0]?.id,
        wabaDetails?.phone_numbers.data[0]?.display_phone_number,
      );

      console.log(' token', accessToken);
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
          console.log('Phone number registration data:', registrationData);

          // Subscribe the app to the WABA for webhook notifications
          const subscriptionData = await this.subscribeAppToWaba(
            wabaId,
            accessToken,
          );
          console.log('App subscription data:', subscriptionData);

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
    console.log(url, params);

    const response = await firstValueFrom(
      this.httpService.get<{ access_token: string }>(url, { params }),
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
      const response = await firstValueFrom(
        this.httpService.get<{ access_token: string }>(url, { params }),
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

    const response = await firstValueFrom(
      this.httpService.get(url, { params }),
    );
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
      const response = await firstValueFrom(
        this.httpService.get(url, { params }),
      );
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

  async getWabaUserById(adminId: Types.ObjectId) {
    // return this.wabaAccountModel.find({
    //   adminId,
    // });
  }

  async getTemplatesForWaba(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    query: GetTemplatesQueryDto = {},
  ): Promise<TemplateResponseDto[]> {
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

    this.logger.log(
      `Fetching templates for WABA ${wabaId} with params: ${JSON.stringify(params)}`,
    );

    try {
      const response = await firstValueFrom(
        this.httpService.get(url, { params }),
      );
      this.logger.log(
        `Successfully fetched ${response.data.data?.length || 0} templates for WABA ${wabaId}`,
      );

      if (
        !Array.isArray(response.data.data) ||
        response.data.data.length === 0
      ) {
        throw new NotFoundException('No templates found for WABA ${wabaId}');
      }

      return response.data.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.error(`Failed to fetch templates for WABA ${wabaId}`, {
        status: axiosError.response?.status,
        data: axiosError.response?.data,
        message: axiosError.message,
      });

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
    console.log(
      'account info',
      account,
      JSON.stringify(createTemplateDto, null, 2),
    );
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

    // Validate that BODY component exists
    const bodyComponent = createTemplateDto.components.find(
      (c) => c.type === 'BODY',
    );
    if (!bodyComponent) {
      throw new InternalServerErrorException(
        'BODY component is required for all templates',
      );
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

          console.log('validHandles', validHandles);

          if (validHandles.length === 0) {
            throw new BadRequestException(
              'Invalid header_handle: must contain at least one valid media handle',
            );
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
      console.log('metaPayload', JSON.stringify(metaPayload, null, 2));
      const response = await firstValueFrom(
        this.httpService.post(url, metaPayload, {
          headers: {
            // <-- Use headers instead of params
            Authorization: `Bearer ${permanentAccessToken}`,
          },
        }),
      );

      this.logger.log(
        `Template created successfully with ID: ${response.data.id}`,
      );
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.error(`Failed to create template for WABA ${wabaId}`, {
        status: axiosError.response?.status,
        data: axiosError.response?.data,
        message: axiosError.message,
      });

      // Provide more specific error messages
      if (axiosError.response?.status === 401) {
        throw new UnauthorizedException(
          'Invalid WhatsApp access token. Please reconfigure your WhatsApp Business Account.',
        );
      } else if (axiosError.response?.status === 403) {
        throw new ForbiddenException(
          'Access denied. Please check your WhatsApp Business Account permissions.',
        );
      } else if (axiosError.response?.status === 400) {
        const errorMessage =
          axiosError.response?.data || 'Invalid template data';
        throw new InternalServerErrorException(
          `Template validation failed: ${errorMessage}`,
        );
      }

      throw new InternalServerErrorException(
        axiosError.response?.data || 'Could not create template.',
      );
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
      const response = await firstValueFrom(
        this.httpService.post(url, metaPayload, {
          params: { access_token: permanentAccessToken },
        }),
      );

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
    console.log('deleteTemplateDto', deleteTemplateDto);
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
      const response = await firstValueFrom(
        this.httpService.delete(url, { params }),
      );

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
      const response = await firstValueFrom(
        this.httpService.get(url, {
          params: {
            access_token: permanentAccessToken,
            fields:
              'name,status,category,language,components,quality_score,rejected_reason',
          },
        }),
      );
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
    bodyVariables?: string[];
    headerMediaAssetId?: string;
    language?: string;
    contactId?: string;
    messageType: WabaMessageType;
    campaignId?: string;
    attendeeId?: Types.ObjectId;
    meetingId?: string;
  }): Promise<any> {
    console.log('payload', payload);

    const {
      adminId,
      projectId,
      meetingId,
      recipientPhoneNumber,
      templateName,
      bodyVariables,
      headerMediaAssetId,
      language,
      contactId,
      attendeeId,
      messageType = 'individual',
      campaignId,
    } = payload;
    this.logger.log(
      `Attempting to send template '${templateName}' from WABA ${projectId} to ${recipientPhoneNumber}`,
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
    }

    templateStructure.components.map((component: any) => {
      console.log(JSON.stringify(component, null, 2))
    })
    // Remove components if empty
    if (templateStructure.components.length === 0) {
      delete templateStructure.components;
    }



    const metaPayload = {
      messaging_product: 'whatsapp',
      to: recipientPhoneNumber,
      type: 'template',
      template: templateStructure,
    };
    console.log(metaPayload)

    try {
      this.logger.log('Sending template message to Meta', metaPayload);
      const response = await firstValueFrom(
        this.httpService.post(url, metaPayload, {
          headers: {
            Authorization: `Bearer ${account.permanentAccessToken}`,
          },
        }),
      );

      this.logger.log(
        `Message sent successfully to ${recipientPhoneNumber}. Message ID: ${response.data.messages[0].id}`,
      );

      // Create WABA message record
      if (response.data?.messages[0]?.id) {
        try {
          await this.wabaMessageService.create({
            projectId: projectId,
            adminId: adminId.toString(),
            phoneNumber: recipientPhoneNumber,
            contactId: contactId,
            wabaMessageId: response.data.messages[0].id,
            messageType,
            templateName: templateName,
            templateLanguage: language || 'en_US',
            messageFormat: 'template',
            templateComponents: templateStructure.components || [],
            displayText: this.renderDisplayText(templateStructure.components || []),
            campaignId,
            attendeeId: attendeeId?.toString(),
            meetingId,
            direction: 'outbound' as any,
          });
        } catch (error) {
          this.logger.error('Failed to create WABA message record:', error);
          // Don't throw error here as the message was sent successfully
        }
      }

      return response.data;
    } catch (error) {
      this.logger.error(
        `Failed to send template message to ${recipientPhoneNumber}`,
        error.response?.data?.error,
      );
      throw new InternalServerErrorException(
        error.response?.data?.error?.message ||
          'Could not send template message.',
      );
    }
  }

  async sendTemplateMessage(
    adminId: Types.ObjectId,
    sendTemplateDto: SendTemplateMessageDto,
    messageType: WabaMessageType = WabaMessageType.INDIVIDUAL,
    campaignId?: string,
  ): Promise<any> {
    const {
      projectId,
      recipientPhoneNumber,
      templateName,
      bodyVariables,
      headerMediaAssetId,
      language,
      contactId,
    } = sendTemplateDto;

    return this.sendSingleTemplateMessage({
      adminId,
      projectId,
      recipientPhoneNumber,
      templateName,
      bodyVariables,
      headerMediaAssetId,
      language,
      contactId,
      messageType,
      campaignId,
    });
  }

  async sendBulkTemplateMessage(
    adminId: Types.ObjectId,
    sendBulkTemplateDto: SendBulkTemplateMessageDto,
  ): Promise<any> {
    const {
      projectId,
      contacts,
      templateName,
      bodyVariables,
      dynamicVariables,
      headerMediaAssetId,
      language,
    } = sendBulkTemplateDto;

    this.logger.log(
      `Attempting to send bulk template '${templateName}' from WABA ${projectId} to ${contacts.length} contacts`,
    );

    const results = {
      sent: 0,
      failed: 0,
      errors: [] as any[],
      messageIds: [] as string[],
    };

    // Send messages to each contact using the unified helper
    for (const contact of contacts) {
      try {
        const response = await this.sendSingleTemplateMessage({
          adminId,
          projectId,
          recipientPhoneNumber: contact.phoneNumber,
          templateName,
          bodyVariables,
          headerMediaAssetId,
          language,
          contactId: contact.contactId,
          messageType: WabaMessageType.INDIVIDUAL,
          campaignId: undefined,
        });

        results.sent++;
        results.messageIds.push(response.messages[0].id);

        // Add a small delay between messages to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        results.failed++;
        results.errors.push({
          contactId: contact.contactId,
          phoneNumber: contact.phoneNumber,
          error: error.response?.data?.error || error.message,
        });

        this.logger.error(
          `Failed to send template message to ${contact.phoneNumber} (Contact ID: ${contact.contactId})`,
          error.response?.data?.error,
        );
      }
    }

    this.logger.log(
      `Bulk message sending completed. Sent: ${results.sent}, Failed: ${results.failed}`,
    );

    return {
      ...results,
      totalContacts: contacts.length,
    };
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
      const response = await firstValueFrom(
        this.httpService.get(url, { params }),
      );
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

  async getTemplatesForWabaTest(): Promise<any> {
    const wabaId = '1055988183368296';
    const accessToken =
      'EAASkZB5UKWQ8BPWggi8ZCItaJoCIriKZCYKSsRQnCY8CpvIs681sYmlh1gHU15t72uziCDuUzpxkcxXAoplFwil1C4E5WiiilaEiKDzZBS4XaDrsGl2F8h2yTzHie8hIuREx6xA2oJ58fOD5Ivy79Bkby1l2yqWnpGnqeW8OYsMj53NuMJLKZBpQLGtMBCB6VaJ3TjoOTdTVBusB38g3ZBFbiZCQUEQvNiN1EYlN1KWZCaMZD';
    const apiVersion = this.configService.get('GRAPH_API_VERSION') || 'v23.0';
    const url = `https://graph.facebook.com/${apiVersion}/${wabaId}/message_templates`;

    try {
      const response = await firstValueFrom(
        this.httpService.get(url, {
          params: {
            access_token: accessToken,
            fields: 'name,status,category,language,components',
          },
        }),
      );
      return response.data.data; // The templates are in the 'data' array
    } catch (error) {
      this.logger.error(
        `Failed to fetch templates for WABA ${wabaId}`,
        error.response?.data,
      );
      throw new InternalServerErrorException(
        'Could not fetch templates from Meta.',
      );
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
      const response = await firstValueFrom(
        this.httpService.post(url, payload, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }),
      );

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
      const response = await firstValueFrom(
        this.httpService.post(
          url,
          {},
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          },
        ),
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

  /**
   * Uploads a sample file to Meta using WhatsApp Media Upload API to get a media ID for templates
   * @param fileBuffer The file buffer to upload
   * @param mimeType The MIME type of the file
   * @param originalName The original filename
   * @returns The media ID from Meta for use in template header_handle field
   */
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
      console.log('project info', project);

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

      const sessionResponse = await firstValueFrom(
        this.httpService.post(createSessionUrl, null, {
          params: sessionParams,
        }),
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

      const uploadResponse = await firstValueFrom(
        this.httpService.post(uploadUrl, fileBuffer, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            file_offset: '0',
            'Content-Type': mimeType,
          },
        }),
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

  /**
   * Gets Meta header handle for generic media by uploading it from server
   * @param adminId The admin ID
   * @param projectId The project ID
   * @param mediaType The type of media ('image', 'video', 'document')
   * @returns The Meta header handle for the generic media
   */
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

  /**
   * Uploads a media asset for sending in messages
   * @param file The uploaded file
   * @param userId The user ID
   * @param projectId The project ID
   * @returns The created MediaAsset document
   */
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

  /**
   * Get media assets for a specific user and project
   * @param userId The user ID
   * @param projectId The project ID
   * @param page The page number for pagination
   * @param limit The number of items per page
   * @returns Paginated media assets
   */
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

  /**
   * Delete a media asset by ID
   * @param userId The user ID
   * @param projectId The project ID
   * @param mediaAssetId The media asset ID to delete
   * @returns Deleted media asset
   */
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
  }) {
    const { fetchedContacts, template, meetingId } = data;

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

    const timer = MonitoringUtil.createTimer();
    const results = {
      total: fetchedContacts.length,
      successful: 0,
      failed: 0,
      errors: [] as Array<{ contactId: string; phone: string; error: string }>,
    };

    try {
      for (const contact of fetchedContacts) {
        try {
          // Validate contact data
          if (!contact) {
            this.logger.warn('Skipping null/undefined contact');
            results.failed++;
            continue;
          }

          if (!contact.phone) {
            this.logger.warn(
              `Skipping contact without phone number: ${contact._id || 'unknown'}`,
            );
            results.failed++;
            results.errors.push({
              contactId: contact._id?.toString() || 'unknown',
              phone: 'N/A',
              error: 'Missing phone number',
            });
            continue;
          }

          // Validate phone number format
          let validatedPhone: string;
          try {
            validatedPhone = ValidationUtil.validatePhoneNumber(contact.phone);
          } catch (validationError) {
            this.logger.warn(
              `Invalid phone number for contact ${contact._id}: ${contact.phone}`,
            );
            results.failed++;
            results.errors.push({
              contactId: contact._id?.toString() || 'unknown',
              phone: contact.phone,
              error: 'Invalid phone number format',
            });
            continue;
          }

          const { variableMappings = [] } = template;

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
                      fallbackValue ||
                        variable.dynamicField ||
                        '[Missing Value]',
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

          const messageResult = await this.sendSingleTemplateMessage({
            adminId: template.adminId,
            projectId: template.project.toString(),
            recipientPhoneNumber: validatedPhone,
            templateName: template.templateName,
            bodyVariables: processedBodyVariables,
            headerMediaAssetId: template.headerMediaAssetId?.toString(),
            language: 'en_US',
            messageType: WabaMessageType.ZOOM_EVENT,
            meetingId,
          });

          this.logger.log(
            `Message sent successfully to ${validatedPhone}. Message ID: ${messageResult.messages?.[0]?.id || 'unknown'}`,
          );

          results.successful++;

          // Add a delay between messages to avoid rate limiting
          await new Promise((resolve) => setTimeout(resolve, 200));
        } catch (error) {
          results.failed++;

          const errorMessage =
            error.response?.data?.error?.message ||
            error.response?.data?.error ||
            error.message ||
            'Unknown error';

          results.errors.push({
            contactId: contact._id?.toString() || 'unknown',
            phone: contact.phone || 'N/A',
            error: errorMessage,
          });

          // Create failed message record
          try {
            const wabaMessageId = uuidv4();
            await this.wabaMessageService.create({
              projectId: template.project.toString(),
              adminId: template.adminId.toString(),
              phoneNumber: contact.phone || 'N/A',
              contactId: contact._id?.toString() || 'unknown',
              wabaMessageId: wabaMessageId,
              messageType: 'individual',
              templateName: template.templateName,
              failureReason: errorMessage,
              status: 'failed',
            });
          } catch (dbError) {
            this.logger.error('Failed to create WABA message record:', dbError);
          }

          this.logger.error(
            `Failed to send message to ${contact.phone || 'N/A'} (Contact ID: ${contact._id?.toString() || 'unknown'})`,
            errorMessage,
          );
        }
      }

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
      throw new InternalServerErrorException(
        'Failed to process template messages',
      );
    }
  }
}
