import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import { WhatsappService } from './whatsapp.service';
import { WHATSAPP_WEBHOOK_QUEUE_NAME } from './whatsapp.queue.module';
import { REDIS_CONNECTION } from 'src/redis/redis.module';

@Injectable()
export class WhatsappWebhookProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsappWebhookProcessor.name);
  private worker: Worker | null = null;

  constructor(
    @Inject(REDIS_CONNECTION)
    private readonly connection: any,
    private readonly configService: ConfigService,
    private readonly whatsappService: WhatsappService,
  ) {}

  onModuleInit() {
    const concurrency =
      this.configService.get<number>('WHATSAPP_WEBHOOK_CONCURRENCY') || 10;

    // Use duplicate connection for blocking worker commands
    const workerConnection = this.connection.duplicate();

    this.worker = new Worker(
      WHATSAPP_WEBHOOK_QUEUE_NAME,
      async (job) => {
        const payload = job.data;
        // Process the payload using the service logic
        return this.whatsappService.processWebhookPayloadLogic(payload);
      },
      {
        connection: workerConnection,
        concurrency,
        removeOnComplete: { age: 24 * 3600 }, // Keep for 24h
        removeOnFail: { count: 1000 },
      },
    );

    this.worker.on('completed', (job) => {
      this.logger.debug(`Webhook job ${job.id} processed successfully`);
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Webhook job ${job?.id} failed: ${err?.message}`,
        err?.stack,
      );
    });
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }
}

