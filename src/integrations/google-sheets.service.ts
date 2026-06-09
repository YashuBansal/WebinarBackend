import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';

@Injectable()
export class GoogleSheetsService {
  private readonly logger = new Logger(GoogleSheetsService.name);
  private sheetsClient: any;

  constructor() {
    this.initAuth();
  }

  private initAuth() {
    try {
      const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
      const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

      if (!clientEmail || !privateKey) {
        this.logger.warn('Google Service Account credentials are not fully configured in environment variables.');
        return;
      }

      const auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: clientEmail,
          private_key: privateKey,
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      this.sheetsClient = google.sheets({ version: 'v4', auth });
      this.logger.log('Google Sheets API client initialized successfully.');
    } catch (error) {
      this.logger.error('Failed to initialize Google Sheets Auth', error);
    }
  }

  async appendRowToSheet(spreadsheetId: string, sheetName: string, rowData: string[]): Promise<any> {
    if (!this.sheetsClient) {
      throw new Error('Google Sheets client is not initialized. Check credentials.');
    }

    try {
      const range = sheetName ? `${sheetName}` : 'Sheet1';
      
      const response = await this.sheetsClient.spreadsheets.values.append({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [rowData],
        },
      });

      return response.data;
    } catch (error: any) {
      this.logger.error(`Error appending to Google Sheet: ${error.message}`);
      throw new Error(`Google Sheets API Error: ${error.message}`);
    }
  }
}
