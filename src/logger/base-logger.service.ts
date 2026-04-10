import { Logger } from '@nestjs/common';

/**
 * Wrapper around NestJS Logger that preserves context and handles metadata
 */
class ContextPreservingLogger extends Logger {
  private readonly fixedContext: string;

  constructor(context: string) {
    super(context);
    this.fixedContext = context;
  }

  log(message: any, ...optionalParams: any[]): void {
    // If second param is an object (metadata), format it into the message
    if (
      optionalParams.length > 0 &&
      typeof optionalParams[0] === 'object' &&
      optionalParams[0] !== null &&
      !(optionalParams[0] instanceof Error)
    ) {
      const metadata = optionalParams[0];
      const formattedMessage = this.formatMessageWithMetadata(
        message,
        metadata,
      );
      super.log(formattedMessage, this.fixedContext);
    } else {
      // Use the fixed context, ignore any context passed as second param
      super.log(message, this.fixedContext);
    }
  }

  warn(message: any, ...optionalParams: any[]): void {
    if (
      optionalParams.length > 0 &&
      typeof optionalParams[0] === 'object' &&
      optionalParams[0] !== null &&
      !(optionalParams[0] instanceof Error)
    ) {
      const metadata = optionalParams[0];
      const formattedMessage = this.formatMessageWithMetadata(
        message,
        metadata,
      );
      super.warn(formattedMessage, this.fixedContext);
    } else {
      super.warn(message, this.fixedContext);
    }
  }

  error(message: any, ...optionalParams: any[]): void {
    // Error signature: error(message, trace?, context?)
    // We need to handle trace (string) and metadata (object) differently
    if (optionalParams.length > 0) {
      const firstParam = optionalParams[0];
      if (
        typeof firstParam === 'string' &&
        optionalParams.length > 1 &&
        typeof optionalParams[1] === 'object'
      ) {
        // error(message, trace, metadata)
        const trace = firstParam;
        const metadata = optionalParams[1];
        const formattedMessage = this.formatMessageWithMetadata(
          message,
          metadata,
        );
        super.error(formattedMessage, trace, this.fixedContext);
      } else if (
        typeof firstParam === 'object' &&
        firstParam !== null &&
        !(firstParam instanceof Error)
      ) {
        // error(message, metadata)
        const metadata = firstParam;
        const formattedMessage = this.formatMessageWithMetadata(
          message,
          metadata,
        );
        super.error(formattedMessage, this.fixedContext);
      } else if (typeof firstParam === 'string') {
        // error(message, trace)
        super.error(message, firstParam, this.fixedContext);
      } else {
        super.error(message, this.fixedContext);
      }
    } else {
      super.error(message, this.fixedContext);
    }
  }

  debug(message: any, ...optionalParams: any[]): void {
    if (
      optionalParams.length > 0 &&
      typeof optionalParams[0] === 'object' &&
      optionalParams[0] !== null &&
      !(optionalParams[0] instanceof Error)
    ) {
      const metadata = optionalParams[0];
      const formattedMessage = this.formatMessageWithMetadata(
        message,
        metadata,
      );
      super.debug(formattedMessage, this.fixedContext);
    } else {
      super.debug(message, this.fixedContext);
    }
  }

  verbose(message: any, ...optionalParams: any[]): void {
    if (
      optionalParams.length > 0 &&
      typeof optionalParams[0] === 'object' &&
      optionalParams[0] !== null &&
      !(optionalParams[0] instanceof Error)
    ) {
      const metadata = optionalParams[0];
      const formattedMessage = this.formatMessageWithMetadata(
        message,
        metadata,
      );
      super.verbose(formattedMessage, this.fixedContext);
    } else {
      super.verbose(message, this.fixedContext);
    }
  }

  private formatMessageWithMetadata(
    message: any,
    metadata: Record<string, any>,
  ): string {
    const messageStr =
      typeof message === 'string' ? message : JSON.stringify(message);
    const metadataStr = JSON.stringify(metadata);
    return `${messageStr} ${metadataStr}`;
  }
}

/**
 * Base service that provides a NestJS Logger instance
 * with the `context` automatically set to the concrete class name.
 *
 * Any service that extends this class will emit logs with
 * `context = <YourServiceClassName>` without having to pass
 * the context string manually on each log call.
 *
 * The logger automatically handles metadata objects passed as the second parameter:
 * - `this.logger.log('Message')` - context is auto-injected
 * - `this.logger.log('Message', { key: 'value' })` - metadata is included, context preserved
 * - `this.logger.error('Error', 'trace', { metadata })` - all parameters supported
 */
export abstract class BaseLoggerService {
  protected readonly logger: ContextPreservingLogger;

  protected constructor() {
    // Use the runtime constructor name as the logger context
    const context = (new.target ?? (this as any).constructor).name;
    this.logger = new ContextPreservingLogger(context);
  }
}
