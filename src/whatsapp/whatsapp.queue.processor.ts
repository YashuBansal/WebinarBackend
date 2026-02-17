import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, Job } from 'bullmq';
import { WhatsappService } from './whatsapp.service';
import {
  getWhatsappTemplateQueueName,
  getWhatsappQueueNamespace,
} from './whatsapp.queue.module';
import { REDIS_CONNECTION } from 'src/redis/redis.module';
import { ISendSingleTemplateMessagePayload } from './dto/msg.dto';
import { ProgramService } from 'src/whatsapp-program/program.service';
import { Types } from 'mongoose';

function isRetryableError(error: any): boolean {
  const status = error?.response?.status;
  const code = error?.code;
  if (status === 429 || (status >= 500 && status < 600)) return true;
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ENOTFOUND') return true;
  if (status === 400 || status === 401 || status === 403) return false;
  return true;
}

@Injectable()
export class WhatsappQueueProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsappQueueProcessor.name);

  private worker: Worker<ISendSingleTemplateMessagePayload> | null = null;

  constructor(
    @Inject(REDIS_CONNECTION)
    private readonly connection: any,
    private readonly configService: ConfigService,
    private readonly whatsappService: WhatsappService,
    @Inject(forwardRef(() => ProgramService))
    private readonly programService: ProgramService,
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

    // Get namespaced queue name and prefix to ensure isolation between app instances
    const queueName = getWhatsappTemplateQueueName(this.configService);
    const namespace = getWhatsappQueueNamespace(this.configService);

    // Initialize BullMQ Worker with the specific type
    this.worker = new Worker<ISendSingleTemplateMessagePayload>(
      queueName,
      async (job: Job<ISendSingleTemplateMessagePayload>) => {
        const payload = job.data;
        const phoneNumber = payload?.formattedPhoneData?.phoneNumber || 'unknown';
        const templateName = payload?.templateName || 'unknown';
        const projectId = payload?.projectId || 'unknown';
        const adminId = payload?.adminId || 'unknown';
        const programAssignmentId = payload?.programAssignmentId;

        const logData = {
          jobId: job.id,
          phoneNumber,
          templateName,
          projectId,
          adminId,
          messageType: payload?.messageType,
          attempt: job.attemptsMade + 1,
          maxAttempts: job.opts?.attempts || 1,
        };
        this.logger.log(
          'Processing queue job - calling optimizedSendSingleTemplateMessage',
          logData,
        );

        try {
          const result =
            await this.whatsappService.optimizedSendSingleTemplateMessage(
              payload,
            );

          this.logger.log('Queue job completed successfully', {
            jobId: job.id,
            phoneNumber,
            templateName,
            success: result?.success,
            messageId: result?.messageId,
          });
          return result;
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : undefined;
          this.logger.error('Queue job failed with error', {
            jobId: job.id,
            phoneNumber,
            templateName,
            error: errorMessage,
            attempt: job.attemptsMade + 1,
          });

          if (programAssignmentId) {
            await this.programService.incrementAssignmentFailureCount(
              new Types.ObjectId(programAssignmentId),
            );
            const assignment =
              await this.programService.getAssignmentByIdForWorker(
                programAssignmentId,
              );
            if (assignment && (assignment as any).failureCount >= 3) {
              await this.programService.pauseAssignmentOnFailure(
                new Types.ObjectId(programAssignmentId),
              );
            }
          }

          const retryable = isRetryableError(error);
          if (!retryable) {
            this.logger.log(
              `Non-retryable error for job ${job.id}, not rethrowing`,
            );
            return {
              success: false,
              code: (error as any)?.response?.data?.error?.code ?? 'UNKNOWN',
              message: errorMessage,
            };
          }
          throw error;
        }
      },
      {
        connection: workerConnection,
        concurrency,
        // Prefix ensures BullMQ keys are grouped per instance (matches Queue configuration)
        prefix: `bull:${namespace}`,
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

