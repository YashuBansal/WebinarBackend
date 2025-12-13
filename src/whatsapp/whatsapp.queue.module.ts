import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Queue, QueueEvents } from 'bullmq';
import { RedisModule, REDIS_CONNECTION } from 'src/redis/redis.module';

export const WHATSAPP_TEMPLATE_QUEUE = 'WHATSAPP_TEMPLATE_QUEUE';
export const WHATSAPP_TEMPLATE_QUEUE_EVENTS =
  'WHATSAPP_TEMPLATE_QUEUE_EVENTS';
export const WHATSAPP_TEMPLATE_QUEUE_NAME = 'whatsapp-template-send';

export const WHATSAPP_WEBHOOK_QUEUE = 'WHATSAPP_WEBHOOK_QUEUE';
export const WHATSAPP_WEBHOOK_QUEUE_NAME = 'whatsapp-webhook-events';

@Module({
  imports: [ConfigModule, RedisModule],
  providers: [
    {
      provide: WHATSAPP_TEMPLATE_QUEUE,
      useFactory: (connection) => {
        return new Queue(WHATSAPP_TEMPLATE_QUEUE_NAME, {
          connection,
          defaultJobOptions: {
            removeOnComplete: { age: 60 * 60 }, // keep for 1h
            removeOnFail: false,
          },
        });
      },
      inject: [REDIS_CONNECTION],
    },
    {
      provide: WHATSAPP_TEMPLATE_QUEUE_EVENTS,
      useFactory: (connection) => {
        return new QueueEvents(WHATSAPP_TEMPLATE_QUEUE_NAME, { connection });
      },
      inject: [REDIS_CONNECTION],
    },
    {
      provide: WHATSAPP_WEBHOOK_QUEUE,
      useFactory: (connection) => {
        return new Queue(WHATSAPP_WEBHOOK_QUEUE_NAME, {
          connection,
          defaultJobOptions: {
            removeOnComplete: { age: 24 * 60 * 60 }, // keep for 24h
            removeOnFail: { count: 1000 },
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 1000,
            },
          },
        });
      },
      inject: [REDIS_CONNECTION],
    },
  ],
  exports: [
    WHATSAPP_TEMPLATE_QUEUE,
    WHATSAPP_TEMPLATE_QUEUE_EVENTS,
    WHATSAPP_WEBHOOK_QUEUE,
  ],
})
export class WhatsappQueueModule {}

