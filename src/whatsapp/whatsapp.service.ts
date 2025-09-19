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
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, lastValueFrom, map } from 'rxjs';
import { UsersService } from 'src/users/users.service';
import { AxiosError } from 'axios';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProjectsService } from 'src/projects/projects.service';
import {
  CreateTemplateDto,
  UpdateTemplateDto,
  GetTemplatesQueryDto,
  DeleteTemplateDto,
  TemplateResponseDto
} from './dto/template.dto';
import { SendTemplateMessageDto } from './dto/msg.dto';

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
    private readonly projectService: ProjectsService
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
  processWebhookPayload(payload: any): void {
    // For now, we just log the payload.
    // In the future, this is where you'll parse the body to find message IDs, statuses, etc.,
    // and then update your MongoDB database.
    console.log('Received webhook payload:', JSON.stringify(payload, null, 2));

    // Example of future logic:
    // if (payload.entry?.[0]?.changes?.[0]?.value?.statuses) {
    //   // handle status update
    // } else if (payload.entry?.[0]?.changes?.[0]?.value?.messages) {
    //   // handle incoming message
    // }
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
      console.log('waba details', wabaDetails?.phone_numbers.data[0]?.id, wabaDetails?.phone_numbers.data[0]?.display_phone_number);

      console.log(' token', accessToken);
      const phoneNumberId = wabaDetails?.phone_numbers.data[0]?.id;
      const phoneNumber = wabaDetails?.phone_numbers.data[0]?.display_phone_number;
      this.logger.log(`Saving connection details for WABA ID: ${wabaId}`);
      const newWabaConnection = await this.projectService.update(adminId, projectId, {
        permanentAccessToken: accessToken,
        wabaId: wabaId,
        phoneNumberId: phoneNumberId,
        phone: phoneNumber,
        appId: this.configService.get('META_APP_ID'),
        appSecret: this.configService.get('META_APP_SECRET'),
      });

      this.logger.log(
        `Successfully connected WABA ${wabaId} for admin ${adminId}`,
      );

      if(newWabaConnection) {
        try {
          // Register the phone number with PIN
          const registrationData = await this.registerPhoneNumber(phoneNumberId, accessToken, '123456');
          console.log('Phone number registration data:', registrationData);
          
          // Subscribe the app to the WABA for webhook notifications
          const subscriptionData = await this.subscribeAppToWaba(wabaId, accessToken);
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
    const account = await this.projectService.findOne(adminId, projectId)
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
      fields: query.fields || 'name,status,category,language,components,quality_score,rejected_reason',
    };

    // Add optional filters
    if (query.status) params.status = query.status;
    if (query.category) params.category = query.category;
    if (query.language) params.language = query.language;
    if (query.limit) params.limit = query.limit;

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

      return response.data.data || []; // Return empty array if no data
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.error(
        `Failed to fetch templates for WABA ${wabaId}`,
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

  // src/whatsapp/whatsapp.service.ts

  async createTemplateForWaba(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    createTemplateDto: CreateTemplateDto,
  ): Promise<TemplateResponseDto> {
    const account = await this.projectService.findOne(adminId, projectId)
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
    const bodyComponent = createTemplateDto.components.find(c => c.type === 'BODY');
    if (!bodyComponent) {
      throw new InternalServerErrorException('BODY component is required for all templates');
    }

    // Build the Meta API payload according to WhatsApp Business Management API
    const metaPayload = {
      name: createTemplateDto.name,
      category: createTemplateDto.category,
      language: createTemplateDto.language,
      components: createTemplateDto.components,
      ...(createTemplateDto.parameter_format && { parameter_format: createTemplateDto.parameter_format }),
      ...(createTemplateDto.library_template_name && { library_template_name: createTemplateDto.library_template_name }),
      ...(createTemplateDto.library_template_button_inputs && { library_template_button_inputs: createTemplateDto.library_template_button_inputs }),
    };

    this.logger.log(
      `Creating template for WABA ${wabaId}: ${JSON.stringify(metaPayload, null, 2)}`,
    );

    try {
      const response = await firstValueFrom(
        this.httpService.post(url, metaPayload, {
          params: { access_token: permanentAccessToken },
        }),
      );

      this.logger.log(`Template created successfully with ID: ${response.data.id}`);
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.error(
        `Failed to create template for WABA ${wabaId}`,
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
        throw new ForbiddenException(
          'Access denied. Please check your WhatsApp Business Account permissions.',
        );
      } else if (axiosError.response?.status === 400) {
        const errorMessage = axiosError.response?.data || 'Invalid template data';
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
    const account = await this.projectService.findOne(adminId, projectId)
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
    if (updateTemplateDto.category) metaPayload.category = updateTemplateDto.category;
    if (updateTemplateDto.components) metaPayload.components = updateTemplateDto.components;

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
    const account = await this.projectService.findOne(adminId, projectId)
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
      this.logger.error(
        `Failed to delete template`,
        error.response?.data,
      );
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
    const account = await this.projectService.findOne(adminId, projectId)
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
            fields: 'name,status,category,language,components,quality_score,rejected_reason',
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

  async sendTemplateMessage(
    adminId: Types.ObjectId,
    sendTemplateDto: SendTemplateMessageDto,
  ): Promise<any> {
    const { projectId, recipientPhoneNumber, templateName, bodyVariables } =
      sendTemplateDto;

    this.logger.log(
      `Attempting to send template '${templateName}' from WABA ${projectId} to ${recipientPhoneNumber}`,
    );

    const account = await this.projectService.findOne(adminId, new Types.ObjectId(projectId))
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

    // --- CONSTRUCT THE META PAYLOAD ---
    // This structure is very specific and must be followed exactly.
    const metaPayload = {
      messaging_product: 'whatsapp',
      to: recipientPhoneNumber,
      type: 'template',
      template: {
        name: templateName,
        language: {
          code: sendTemplateDto.language || 'en_US',
        },
        components: [
          {
            type: 'body',
            parameters: bodyVariables?.map((variable) => ({
              type: 'text',
              text: variable,
            })),
          },
        ],
      },
    };

    // Remove the components array if there are no variables to send
    if (!bodyVariables || bodyVariables.length === 0) {
      delete metaPayload.template.components;
    }

    try {
      console.log(url);
      console.log(metaPayload);
      console.log(account.permanentAccessToken);
      const response = await firstValueFrom(
        this.httpService.post(url, metaPayload, {
          headers: { Authorization: `Bearer ${account.permanentAccessToken}` },
        }),
      );
      this.logger.log(
        `Message sent successfully. Message ID: ${JSON.stringify(response.data.messages[0])}`,
      );
      return response.data;
    } catch (error) {
      this.logger.error(
        `Failed to send template message for WABA ${projectId}`,
        error.response?.data?.error,
      );
      throw new InternalServerErrorException(
        error.response?.data?.error?.message ||
        'Could not send template message.',
      );
    }
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

  async sendTemplateMessagetest(): Promise<any> {
    const wabaId = '1055988183368296';
    const recipientPhoneNumber = '918929544444';
    const templateName = 'test_temp'; // 👈 updated to your approved template name

    this.logger.log(
      `Attempting to send template '${templateName}' from WABA ${wabaId} to ${recipientPhoneNumber}`,
    );

    const fromPhoneNumberId = '718532331347163';
    if (!fromPhoneNumberId) {
      throw new NotFoundException(
        'No sending phone number found for this WABA.',
      );
    }

    const accessToken = 'EAASkZB5UKWQ8BPRFoH9Bw3K9PuuoCXeUEFU92pZALNF3gQj15saVwjdi3MpBpaRETF10UZBnj8lDceFKTzBRXOqMZAuOCQArAL7ldp2QYAmpNDUzwZAyNl7FZCTRCF7j0eDDxH7uDBf26dMODL9SFf4LK15ZBpVZCPTB9hDJnV8qCE8cZBq3ZCKyUmN6gDbYUZA5zFRz8FwE6QQmGEKHj7V1LUSoRZC8WBRqtd3eYLzst2DuNcgZD';
    const apiVersion = this.configService.get('GRAPH_API_VERSION') || 'v23.0';
    const url = `https://graph.facebook.com/${apiVersion}/${fromPhoneNumberId}/messages`;

    // --- CONSTRUCT THE META PAYLOAD ---
    // Match the structure of your approved template exactly
    const metaPayload = {
      messaging_product: 'whatsapp',
      to: recipientPhoneNumber,
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'en' }, // 👈 use 'en' because your template is defined with "language": "en"
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: 'Ajay', // 👈 value for {{1}} placeholder
              },
            ],
          },
        ],
      },
    };

    try {
      console.log(url);
      console.log(JSON.stringify(metaPayload, null, 2));

      const response = await firstValueFrom(
        this.httpService.post(url, metaPayload, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      );

      this.logger.log(
        `✅ Message sent successfully. Message ID: ${response.data.messages[0].id}`,
      );
      return response.data;
    } catch (error) {
      this.logger.error(
        `❌ Failed to send template message for WABA ${wabaId}`,
        error.response?.data?.error,
      );
      throw new InternalServerErrorException(
        error.response?.data?.error?.message ||
        'Could not send template message.',
      );
    }
  }


  async sendTemplateMessagetest2(): Promise<any> {
    const wabaId = '1055988183368296';
    const recipientPhoneNumber = '918929544444';
    const templateName = 'testwala';

    this.logger.log(
      `Attempting to send template '${templateName}' from WABA ${wabaId} to ${recipientPhoneNumber}`,
    );

    // We need the Phone Number ID from the WABA to send a message
    const fromPhoneNumberId = '718532331347163';
    if (!fromPhoneNumberId) {
      throw new NotFoundException(
        'No sending phone number found for this WABA.',
      );
    }

    const accessToken =
      'EAASkZB5UKWQ8BPRFoH9Bw3K9PuuoCXeUEFU92pZALNF3gQj15saVwjdi3MpBpaRETF10UZBnj8lDceFKTzBRXOqMZAuOCQArAL7ldp2QYAmpNDUzwZAyNl7FZCTRCF7j0eDDxH7uDBf26dMODL9SFf4LK15ZBpVZCPTB9hDJnV8qCE8cZBq3ZCKyUmN6gDbYUZA5zFRz8FwE6QQmGEKHj7V1LUSoRZC8WBRqtd3eYLzst2DuNcgZD';
    const apiVersion = this.configService.get('GRAPH_API_VERSION') || 'v23.0';
    const url = `https://graph.facebook.com/${apiVersion}/${fromPhoneNumberId}/messages`;

    // --- CONSTRUCT THE META PAYLOAD ---
    // This structure is very specific and must be followed exactly.
    const metaPayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',

      to: recipientPhoneNumber,

      type: 'text',
      text: {
        preview_url: false, // Set to true if your message contains a URL you want to preview
        body: 'hello rittik ji.',
      },
    };

    try {
      console.log(url);
      console.log(metaPayload);
      console.log(accessToken);
      const response = await firstValueFrom(
        this.httpService.post(url, metaPayload, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      );
      this.logger.log(
        `Message sent successfully. Message ID: ${response.data.messages[0].id}`,
      );
      return response.data;
    } catch (error) {
      this.logger.error(
        `Failed to send template message for WABA ${wabaId}`,
        error.response?.data?.error,
      );
      throw new InternalServerErrorException(
        error.response?.data?.error?.message ||
        'Could not send template message.',
      );
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

      this.logger.log(
        `Phone number ${phoneNumberId} registered successfully`,
      );
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.error(
        `Failed to register phone number ${phoneNumberId}`,
        {
          status: axiosError.response?.status,
          data: axiosError.response?.data,
          message: axiosError.message,
        },
      );

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
        typeof axiosError.response?.data === 'string' ? axiosError.response?.data :
          'Could not register phone number.',
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
  async subscribeAppToWaba(
    wabaId: string,
    accessToken: string,
  ): Promise<any> {
    const apiVersion = this.configService.get('GRAPH_API_VERSION') || 'v23.0';
    const url = `https://graph.facebook.com/${apiVersion}/${wabaId}/subscribed_apps`;

    this.logger.log(`Subscribing app to WABA ${wabaId}`);

    try {
      const response = await firstValueFrom(
        this.httpService.post(url, {}, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }),
      );

      this.logger.log(
        `App successfully subscribed to WABA ${wabaId}`,
      );
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.error(
        `Failed to subscribe app to WABA ${wabaId}`,
        {
          status: axiosError.response?.status,
          data: axiosError.response?.data,
          message: axiosError.message,
        },
      );

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
        typeof axiosError.response?.data === 'string' ? axiosError.response?.data :
          'Could not subscribe app to WABA.',
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
}
