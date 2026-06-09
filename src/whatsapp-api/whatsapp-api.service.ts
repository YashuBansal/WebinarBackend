import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class WhatsappApiService {
  private readonly logger = new Logger(WhatsappApiService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Helper to mask sensitive phone numbers for secure logging.
   */
  private maskPhone(phone: string): string {
    if (!phone) return '***';
    const clean = phone.replace(/[^0-9]/g, '');
    if (clean.length > 5) {
      return `${clean.substring(0, 3)}*****${clean.substring(clean.length - 3)}`;
    }
    return '***';
  }

  /**
   * Sends a template message using the Meta Graph API.
   * Constructs the Meta API request payload and sends it.
   */
  async sendTemplateMessage(
    wabaAccountId: string,
    toPhone: string,
    templateName: string,
    variablesObject: Record<string, string>,
    accessToken?: string,
  ): Promise<any> {
    try {
      const token = accessToken || this.configService.get<string>('META_ACCESS_TOKEN') || process.env.META_ACCESS_TOKEN;

      // 1. Strict credentials and parameters validation
      if (!wabaAccountId) {
        throw new Error('Meta Graph API call failed: phoneNumberId (wabaAccountId) is undefined or null');
      }
      if (!token) {
        throw new Error('Meta Graph API call failed: permanentAccessToken (accessToken) is undefined or null');
      }
      if (!toPhone) {
        throw new Error('Meta Graph API call failed: recipient phone number is undefined or null');
      }
      if (!templateName) {
        throw new Error('Meta Graph API call failed: templateName is undefined or null');
      }

      // 2. Data Sanitization: Strip spaces, plus signs, hyphens, and parentheses to keep only numeric values
      const sanitizedPhone = toPhone.replace(/[^0-9]/g, '');
      if (!sanitizedPhone) {
        throw new Error(`Meta Graph API call failed: phone number "${toPhone}" after sanitization is empty`);
      }

      const apiVersion = this.configService.get<string>('GRAPH_API_VERSION') || 'v19.0';
      const url = `https://graph.facebook.com/${apiVersion}/${wabaAccountId}/messages`;

      const maskedPhone = this.maskPhone(sanitizedPhone);
      this.logger.log(
        `Sending template message "${templateName}" to ${maskedPhone} using WABA ${wabaAccountId}`
      );

      // Map numerical parameters to Meta body components in sorted order
      const parameters = Object.keys(variablesObject || {})
        .sort((a, b) => parseInt(a) - parseInt(b))
        .map((key) => ({
          type: 'text',
          text: String(variablesObject[key]),
        }));

      const components = parameters.length > 0 ? [{ type: 'body', parameters }] : [];

      const payload = {
        messaging_product: 'whatsapp',
        to: sanitizedPhone,
        type: 'template',
        template: {
          name: templateName,
          language: {
            code: 'en_US', // Default standard language
          },
          components,
        },
      };

      const response = await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000, // 15 seconds timeout
      });

      this.logger.log(`Template message sent successfully to ${maskedPhone}.`);
      return response.data;
    } catch (error: any) {
      const errorMsg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      this.logger.error(`Failed to send WhatsApp template message to ${this.maskPhone(toPhone)}: ${errorMsg}`);
      // Throw the error so calling services (and Bull Queue workers) can retry properly
      throw error;
    }
  }
}
