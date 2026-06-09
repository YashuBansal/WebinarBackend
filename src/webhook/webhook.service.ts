import { Injectable, Logger } from '@nestjs/common';
import { FlowExecutionService } from '../flow-execution/flow-execution.service';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly flowExecutionService: FlowExecutionService,
  ) {}

  /**
   * Processes the incoming WhatsApp Meta payload asynchronously.
   * Parses the deeply nested Meta JSON and extracts essential data points.
   */
  async processPayload(payload: any): Promise<void> {
    try {
      this.logger.log('Received WhatsApp webhook payload for parsing');

      if (!payload || typeof payload !== 'object') {
        this.logger.warn('Received invalid or empty webhook payload');
        return;
      }

      const entry = payload.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;

      if (!value) {
        this.logger.warn('Webhook payload contains no change value');
        return;
      }

      // Check if the payload is a status update (like "sent", "delivered", "read")
      if (value.statuses && Array.isArray(value.statuses) && value.statuses.length > 0) {
        const firstStatus = value.statuses[0];
        this.logger.log(
          `Status update received: Message ID ${firstStatus.id} status changed to "${firstStatus.status}"`
        );
        return;
      }

      // Check if there are messages in the payload
      if (!value.messages || !Array.isArray(value.messages) || value.messages.length === 0) {
        this.logger.debug('Webhook payload contains no messages or statuses to process');
        return;
      }

      const message = value.messages[0];

      // 1. Extract WABA business account ID / phone number ID
      const wabaAccountId = value.metadata?.phone_number_id || entry?.id;

      // 2. Extract customer phone number
      const customerPhoneNumber = message.from;

      // 3. Extract incoming message text body or button payload
      let incomingMessage: string | null = null;
      const messageType = message.type;

      if (messageType === 'text') {
        incomingMessage = message.text?.body;
      } else if (messageType === 'button') {
        incomingMessage = message.button?.payload || message.button?.text || null;
      } else if (messageType === 'interactive') {
        const interactive = message.interactive;
        if (interactive?.type === 'button_reply') {
          incomingMessage = interactive.button_reply?.payload || interactive.button_reply?.title || null;
        } else if (interactive?.type === 'list_reply') {
          incomingMessage = interactive.list_reply?.id || interactive.list_reply?.title || null;
        }
      }

      // Log extracted parameters
      this.logger.log('--- WhatsApp Webhook Parsed Event ---');
      this.logger.log(`WABA Account ID / Phone ID: ${wabaAccountId}`);
      this.logger.log(`Customer Phone Number:     ${customerPhoneNumber}`);
      this.logger.log(`Message Content:            ${incomingMessage}`);
      this.logger.log(`Message Type:               ${messageType}`);
      this.logger.log('------------------------------------');

      // Trigger the graph execution flow execution service asynchronously
      if (wabaAccountId && customerPhoneNumber) {
        this.flowExecutionService
          .processIncomingMessage(wabaAccountId, customerPhoneNumber, incomingMessage || '')
          .catch((err) => {
            this.logger.error('Failed to execute flow execution graph traversal:', err);
          });
      }
    } catch (error) {
      this.logger.error(
        'Error parsing incoming WhatsApp webhook payload:',
        error instanceof Error ? error.stack : error
      );
    }
  }
}
