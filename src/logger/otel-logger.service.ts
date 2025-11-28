import { Injectable, LoggerService, LogLevel } from '@nestjs/common';

import { logs } from '@opentelemetry/api-logs';

import { SeverityNumber } from '@opentelemetry/api-logs';

/**
 * Custom NestJS Logger that integrates with OpenTelemetry
 * This allows you to use NestJS Logger normally, and logs will be sent to Signoz
 */
@Injectable()
export class OtelLoggerService implements LoggerService {
  private readonly otelLogger = logs.getLogger('nestjs-app');

  /**
   * Maps NestJS log levels to OpenTelemetry SeverityNumber
   */
  private getSeverityNumber(level: LogLevel): SeverityNumber {
    switch (level) {
      case 'error':
        return SeverityNumber.ERROR;
      case 'warn':
        return SeverityNumber.WARN;
      case 'log':
      case 'debug':
        return SeverityNumber.INFO;
      case 'verbose':
        return SeverityNumber.DEBUG;
      default:
        return SeverityNumber.INFO;
    }
  }

  /**
   * Maps NestJS log levels to severity text
   */
  private getSeverityText(level: LogLevel): string {
    return level.toUpperCase();
  }

  log(message: any, context?: string) {
    this.emitLog('log', message, context);
    // Also log to console for local development
    console.log(`[${context || 'App'}] ${message}`);
  }

  error(message: any, trace?: string, context?: string) {
    this.emitLog('error', message, context, trace);
    // Also log to console for local development
    console.error(`[${context || 'App'}] ${message}`, trace || '');
  }

  warn(message: any, context?: string) {
    this.emitLog('warn', message, context);
    // Also log to console for local development
    console.warn(`[${context || 'App'}] ${message}`);
  }

  debug(message: any, context?: string) {
    this.emitLog('debug', message, context);
    // Also log to console for local development
    console.debug(`[${context || 'App'}] ${message}`);
  }

  verbose(message: any, context?: string) {
    this.emitLog('verbose', message, context);
    // Also log to console for local development
    console.log(`[${context || 'App'}] VERBOSE: ${message}`);
  }

  /**
   * Emit log to OpenTelemetry
   */
  private emitLog(
    level: LogLevel,
    message: any,
    context?: string,
    trace?: string,
  ) {
    try {
      const logRecord = {
        severityNumber: this.getSeverityNumber(level),
        severityText: this.getSeverityText(level),
        body: typeof message === 'string' ? message : JSON.stringify(message),
        attributes: {
          'log.context': context || 'App',
          'log.level': level,
          ...(trace && { 'log.trace': trace }),
        },
      };
      this.otelLogger.emit(logRecord);
    } catch (error) {
      // Silently fail to avoid breaking the application
      // Logs will still appear in console
    }
  }
}

