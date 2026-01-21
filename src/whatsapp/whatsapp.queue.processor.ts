import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, Job } from 'bullmq'; // Added Job to imports
import { WhatsappService } from './whatsapp.service';
import { WHATSAPP_TEMPLATE_QUEUE_NAME } from './whatsapp.queue.module';
import { REDIS_CONNECTION } from 'src/redis/redis.module';
import { ISendSingleTemplateMessagePayload } from './dto/msg.dto'; // Import the DTO interface

@Injectable()
export class WhatsappQueueProcessor implements OnModuleInit, OnModuleDestroy {
  // Logger instance for tracking processor activities and errors
  private readonly logger = new Logger(WhatsappQueueProcessor.name);
  
  // BullMQ Worker instance handling job processing
  // Enforce the payload type on the Worker
  private worker: Worker<ISendSingleTemplateMessagePayload> | null = null;

  /**
   * Initializes the processor with required dependencies.
   * @param connection Redis connection for BullMQ
   * @param configService Service to access configuration variables
   * @param whatsappService Service to handle actual WhatsApp message sending
   */
  constructor(
    @Inject(REDIS_CONNECTION)
    private readonly connection: any,
    private readonly configService: ConfigService,
    private readonly whatsappService: WhatsappService,
  ) {}

  /**
   * Lifecycle hook called when the module is initialized.
   * Sets up the BullMQ worker with concurrency, rate limiting, and event handlers.
   */
  onModuleInit() {
    // Number of concurrent jobs the worker can process
    const concurrency =
      this.configService.get<number>('WHATSAPP_QUEUE_CONCURRENCY') || 8;
    
    // Maximum number of messages to send per second per WABA
    const rateLimitPerSecond =
      this.configService.get<number>('WHATSAPP_QUEUE_RATE_PER_WABA') || 20;
    
    // Timeout for individual job processing in milliseconds
    const jobTimeoutMs =
      this.configService.get<number>('WHATSAPP_QUEUE_TIMEOUT_MS') || 20000;

    // Isolate worker connection to avoid blocking the global shared connection
    // 'duplicate' creates a new connection with the same options
    const workerConnection = this.connection.duplicate();

    // Initialize BullMQ Worker with the specific type
    this.worker = new Worker<ISendSingleTemplateMessagePayload>(
      WHATSAPP_TEMPLATE_QUEUE_NAME,
      async (job: Job<ISendSingleTemplateMessagePayload>) => {
        const payload = job.data;
        const phoneNumber = payload?.formattedPhoneData?.phoneNumber || 'unknown';
        const templateName = payload?.templateName || 'unknown';
        const projectId = payload?.projectId || 'unknown';
        const adminId = payload?.adminId || 'unknown';
        
        // Log job start with key details
        this.logger.log('Processing queue job - calling optimizedSendSingleTemplateMessage', {
          jobId: job.id,
          jobName: job.name,
          phoneNumber,
          templateName,
          projectId,
          adminId,
          messageType: payload?.messageType,
          attempt: job.attemptsMade + 1,
          maxAttempts: job.opts?.attempts || 1,
        });

        try {
          // Call the method and capture result
          const result = await this.whatsappService.optimizedSendSingleTemplateMessage(payload);
          
          // Log successful completion
          this.logger.log('Queue job completed successfully', {
            jobId: job.id,
            phoneNumber,
            templateName,
            projectId,
            success: result?.success,
            messageId: result?.messageId,
          });
          
          return result;
        } catch (error) {
          // Log error with full context
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : undefined;
          
          this.logger.error('Queue job failed with error', {
            jobId: job.id,
            phoneNumber,
            templateName,
            projectId,
            adminId,
            error: errorMessage,
            stack: errorStack,
            errorType: error?.constructor?.name || typeof error,
            attempt: job.attemptsMade + 1,
          });
          
          // Re-throw to let BullMQ handle retries
          throw error;
        }
      },
      {
        connection: workerConnection,
        concurrency,
        // lockDuration should be > job timeout to prevent processing same job twice
        // Default is 30s. If job timeout is 20s, 60s is safe.
        lockDuration: Math.max(jobTimeoutMs * 2, 60000),
        limiter: {
          // Per-WABA rate limiting; cast to any to allow groupKey
          groupKey: 'fromPhoneNumberId',
          max: rateLimitPerSecond,
          duration: 1000,
        } as any,
      },
    );

    // Event listener for successful job completion
    this.worker.on('completed', (job: Job<ISendSingleTemplateMessagePayload>) => {
      this.logger.log(
        `Job ${job.id} for recipient ${job.data?.formattedPhoneData?.phoneNumber} completed`,
      );
    });
    
    // Event listener for job failure
    this.worker.on('failed', (job: Job<ISendSingleTemplateMessagePayload> | undefined, err) => {
      this.logger.error(
        `Job ${job?.id} failed: ${err?.message}`,
        err?.stack,
      );
    });
  }

  /**
   * Lifecycle hook called when the module is destroyed.
   * Gracefully shuts down the worker.
   */
  async onModuleDestroy() {
    if (this.worker) {
      this.logger.log('Closing WhatsApp queue worker...');
      await this.worker.close();
      this.worker = null;
      this.logger.log('WhatsApp queue worker closed');
    }
  }
}

