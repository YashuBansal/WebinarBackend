import Transport from 'winston-transport';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import type { LogRecord } from '@opentelemetry/api-logs';

/**
 * Winston transport that sends logs to OpenTelemetry
 */
export class OtelWinstonTransport extends Transport {
  private otelLogger: ReturnType<typeof logs.getLogger>;
  private serviceName: string;
  private isOtelEnabled: boolean;

  constructor(opts?: Transport.TransportStreamOptions & { serviceName?: string }) {
    super(opts);
    this.serviceName = opts?.serviceName || process.env.OTEL_SERVICE_NAME || 'webinar-leads-hub';
    // Check if OTEL is enabled by verifying environment variables
    this.isOtelEnabled = !!(
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT && process.env.OTEL_SERVICE_NAME
    );
    this.otelLogger = logs.getLogger(this.serviceName);
  }

  log(info: any, callback: () => void): void {
    setImmediate(() => {
      this.emit('logged', info);
    });

    // Map Winston log levels to OpenTelemetry severity numbers
    const severityNumber = this.mapWinstonLevelToSeverity(info.level);
    const severityText = info.level.toUpperCase();

    // Extract message and context
    const message = typeof info.message === 'string' ? info.message : JSON.stringify(info.message);
    const context = info.context || 'Application';

    // Build attributes from Winston metadata
    const attributes: Record<string, any> = {
      'log.level': info.level,
      'log.logger': 'winston',
      'service.name': this.serviceName,
    };

    // Add context if available
    if (context) {
      attributes['log.context'] = context;
    }

    // Add timestamp if available
    if (info.timestamp) {
      attributes['log.timestamp'] = info.timestamp;
    }

    // Add any additional metadata as attributes
    if (info.metadata && typeof info.metadata === 'object') {
      Object.keys(info.metadata).forEach((key) => {
        if (key !== 'message' && key !== 'level' && key !== 'context' && key !== 'timestamp') {
          attributes[`log.${key}`] = info.metadata[key];
        }
      });
    }

    // Add error details if present
    if (info.error || info.err) {
      const error = info.error || info.err;
      if (error instanceof Error) {
        attributes['error.type'] = error.name;
        attributes['error.message'] = error.message;
        if (error.stack) {
          attributes['error.stack'] = error.stack;
        }
      }
    }

    // Emit log to OpenTelemetry only if enabled
    if (this.isOtelEnabled) {
      try {
        this.otelLogger.emit({
          severityNumber,
          severityText,
          body: message,
          attributes,
        } as LogRecord);
      } catch (error) {
        // Silently fail if OTEL is not initialized
        // This prevents Winston from crashing if OTEL is disabled
      }
    }

    callback();
  }

  /**
   * Maps Winston log levels to OpenTelemetry severity numbers
   */
  private mapWinstonLevelToSeverity(level: string): SeverityNumber {
    const normalizedLevel = level.toLowerCase();

    switch (normalizedLevel) {
      case 'error':
        return SeverityNumber.ERROR;
      case 'warn':
      case 'warning':
        return SeverityNumber.WARN;
      case 'info':
        return SeverityNumber.INFO;
      case 'debug':
        return SeverityNumber.DEBUG;
      case 'verbose':
      case 'silly':
        return SeverityNumber.TRACE;
      default:
        return SeverityNumber.INFO;
    }
  } 
}
