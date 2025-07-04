import { HttpService } from '@nestjs/axios';
import {
  Injectable,
  NotAcceptableException,
  forwardRef,
  Inject,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom, map, NotFoundError } from 'rxjs';
import { AlarmMsgDto, ReminderMsgDto } from './dto/msg.dto';
import { UsersService } from 'src/users/users.service';
import { AxiosError } from 'axios';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
  ) {}

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
   * A private, reusable method to call the external webhook.
   * It centralizes the HTTP call logic and error handling.
   * @param payload The data to be sent to the webhook.
   */
  async callExternalWebhook(payload: Record<string, any>) {
    console.log(payload)
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

  private isValidPhoneNumber(phoneNumber: string) {
    // Define the regex pattern for validation
    const phoneRegex = /^\+\d{1,3}\d{9}$/;

    // Test the phone number against the regex
    return phoneRegex.test(phoneNumber);
  }

  async sendAlarmMsg(alarmMsgDto: AlarmMsgDto) {
    if (!this.isValidPhoneNumber(alarmMsgDto.phone)) return;

    if (!this.apiKey) {
      console.error('AISENSY API KEY NOT FOUND.');
      return { error: 'AISENSY API KEY NOT FOUND.' };
    }

    try {
      const bodyData = {
        apiKey: this.configService.get('AISENSY_KEY'),
        campaignName: this.configService.get('ALARM_CAMPAIGN'),
        destination: alarmMsgDto.phone,
        userName: alarmMsgDto.userName,
        templateParams: [
          alarmMsgDto.userName,
          alarmMsgDto.attendeeEmail,
          alarmMsgDto.note,
        ],
      };
      const result = await lastValueFrom(
        this.httpService
          .post(this.url, bodyData)
          .pipe(map((resp) => resp.data)),
      );
      return result;
    } catch (error) {
      console.error('Failed to send alarm message:', error.message);
      return { error: error.message };
    }
  }

  async sendReminderMsg(reminderMsgDto: ReminderMsgDto) {
    if (!this.isValidPhoneNumber(reminderMsgDto.phone)) return;

    if (!this.apiKey) {
      console.error('AISENSY API KEY NOT FOUND.');
      return { error: 'AISENSY API KEY NOT FOUND.' };
    }

    try {
      const bodyData = {
        apiKey: this.configService.get('AISENSY_KEY'),
        campaignName: this.configService.get('REMINDER_CAMPAIGN'),
        destination: reminderMsgDto.phone,
        userName: reminderMsgDto.userName,
        templateParams: [
          reminderMsgDto.userName,
          reminderMsgDto.attendeeEmail,
          reminderMsgDto.note,
        ],
      };
      const result = await lastValueFrom(
        this.httpService
          .post(this.url, bodyData)
          .pipe(map((resp) => resp.data)),
      );
      return result;
    } catch (error) {
      console.error('Failed to send reminder message:', error.message);
      return { error: error.message };
    }
  }
}
