import { Logger } from '@nestjs/common';

export interface MessageEventMetrics {
  eventType: string;
  meetingId?: string;
  templateName?: string;
  totalContacts: number;
  successfulMessages: number;
  failedMessages: number;
  processingTimeMs: number;
  timestamp: Date;
  errors?: Array<{contactId: string, error: string}>;
}

export class MonitoringUtil {
  private static readonly logger = new Logger(MonitoringUtil.name);

  /**
   * Logs structured metrics for message events
   */
  static logMessageEventMetrics(metrics: MessageEventMetrics): void {
    const successRate = metrics.totalContacts > 0 
      ? (metrics.successfulMessages / metrics.totalContacts * 100).toFixed(2)
      : '0';

    this.logger.log('Message Event Metrics', {
      eventType: metrics.eventType,
      meetingId: metrics.meetingId,
      templateName: metrics.templateName,
      totalContacts: metrics.totalContacts,
      successfulMessages: metrics.successfulMessages,
      failedMessages: metrics.failedMessages,
      successRate: `${successRate}%`,
      processingTimeMs: metrics.processingTimeMs,
      timestamp: metrics.timestamp.toISOString()
    });

    // Log warnings for high failure rates
    if (metrics.failedMessages > 0) {
      const failureRate = (metrics.failedMessages / metrics.totalContacts * 100).toFixed(2);
      this.logger.warn(`High failure rate detected: ${failureRate}%`, {
        eventType: metrics.eventType,
        meetingId: metrics.meetingId,
        failedCount: metrics.failedMessages,
        totalCount: metrics.totalContacts
      });
    }

    // Log individual errors for debugging
    if (metrics.errors && metrics.errors.length > 0) {
      metrics.errors.forEach(error => {
        this.logger.debug(`Message failed for contact ${error.contactId}: ${error.error}`);
      });
    }
  }

  /**
   * Logs webhook processing metrics
   */
  static logWebhookMetrics(eventType: string, meetingId: string, processingTimeMs: number, success: boolean): void {
    this.logger.log('Webhook Processing Metrics', {
      eventType,
      meetingId,
      processingTimeMs,
      success,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Logs API call metrics
   */
  static logApiCallMetrics(
    service: string,
    endpoint: string,
    method: string,
    statusCode: number,
    responseTimeMs: number,
    error?: string
  ): void {
    const level = statusCode >= 400 ? 'warn' : 'log';
    this.logger[level]('API Call Metrics', {
      service,
      endpoint,
      method,
      statusCode,
      responseTimeMs,
      error,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Logs database operation metrics
   */
  static logDatabaseMetrics(
    operation: string,
    collection: string,
    durationMs: number,
    success: boolean,
    error?: string
  ): void {
    const level = success ? 'debug' : 'warn';
    this.logger[level]('Database Operation Metrics', {
      operation,
      collection,
      durationMs,
      success,
      error,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Creates a performance timer
   */
  static createTimer(): () => number {
    const startTime = Date.now();
    return () => Date.now() - startTime;
  }

  /**
   * Logs critical system events
   */
  static logCriticalEvent(event: string, details: any): void {
    this.logger.error('Critical System Event', {
      event,
      details,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Logs security events
   */
  static logSecurityEvent(event: string, details: any): void {
    this.logger.warn('Security Event', {
      event,
      details,
      timestamp: new Date().toISOString()
    });
  }
}
