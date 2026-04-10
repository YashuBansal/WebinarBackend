import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Queue, QueueEvents } from 'bullmq';
import { RedisModule, REDIS_CONNECTION } from 'src/redis/redis.module';

// Injection tokens for queues / queue events
export const WHATSAPP_TEMPLATE_QUEUE = 'WHATSAPP_TEMPLATE_QUEUE';
export const WHATSAPP_TEMPLATE_QUEUE_EVENTS = 'WHATSAPP_TEMPLATE_QUEUE_EVENTS';
export const WHATSAPP_WEBHOOK_QUEUE = 'WHATSAPP_WEBHOOK_QUEUE';

// Base (non-namespaced) queue names
export const WHATSAPP_TEMPLATE_QUEUE_BASE_NAME = 'whatsapp-template-send';
export const WHATSAPP_WEBHOOK_QUEUE_BASE_NAME = 'whatsapp-webhook-events';

// Env key for per-instance WhatsApp queue namespace
export const WHATSAPP_QUEUE_NAMESPACE_ENV = 'WHATSAPP_QUEUE_NAMESPACE';

// Internal helper to resolve the namespace, preferring ConfigService and finally a safe default.
const DEFAULT_WHATSAPP_QUEUE_NAMESPACE = 'default';

function resolveWhatsappQueueNamespace(configService?: ConfigService): string {
  const fromConfig = configService?.get<string>(WHATSAPP_QUEUE_NAMESPACE_ENV);

  return fromConfig || DEFAULT_WHATSAPP_QUEUE_NAMESPACE;
}

// Public helpers so workers and other modules can use the exact same logic
// when constructing queue names / prefixes.
export function getWhatsappQueueNamespace(
  configService?: ConfigService,
): string {
  return resolveWhatsappQueueNamespace(configService);
}

export function getWhatsappTemplateQueueName(
  configService?: ConfigService,
): string {
  const namespace = resolveWhatsappQueueNamespace(configService);
  // NOTE: BullMQ queue names cannot contain ':'
  return `${WHATSAPP_TEMPLATE_QUEUE_BASE_NAME}_${namespace}`;
}

export function getWhatsappWebhookQueueName(
  configService?: ConfigService,
): string {
  const namespace = resolveWhatsappQueueNamespace(configService);
  // NOTE: BullMQ queue names cannot contain ':'
  return `${WHATSAPP_WEBHOOK_QUEUE_BASE_NAME}_${namespace}`;
}

@Module({
  imports: [ConfigModule, RedisModule],
  providers: [
    {
      provide: WHATSAPP_TEMPLATE_QUEUE,
      useFactory: (connection, configService: ConfigService) => {
        const namespace = resolveWhatsappQueueNamespace(configService);
        const queueName = getWhatsappTemplateQueueName(configService);

        return new Queue(queueName, {
          connection,
          // Prefix ensures BullMQ keys are grouped per instance
          prefix: `bull:${namespace}`,
          defaultJobOptions: {
            removeOnComplete: { age: 60 * 60 }, // keep for 1h
            removeOnFail: false,
          },
        });
      },
      inject: [REDIS_CONNECTION, ConfigService],
    },
    {
      provide: WHATSAPP_TEMPLATE_QUEUE_EVENTS,
      useFactory: (connection, configService: ConfigService) => {
        const namespace = resolveWhatsappQueueNamespace(configService);
        const queueName = getWhatsappTemplateQueueName(configService);

        return new QueueEvents(queueName, {
          connection,
          prefix: `bull:${namespace}`,
        });
      },
      inject: [REDIS_CONNECTION, ConfigService],
    },
    {
      provide: WHATSAPP_WEBHOOK_QUEUE,
      useFactory: (connection, configService: ConfigService) => {
        const namespace = resolveWhatsappQueueNamespace(configService);
        const queueName = getWhatsappWebhookQueueName(configService);

        return new Queue(queueName, {
          connection,
          prefix: `bull:${namespace}`,
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
      inject: [REDIS_CONNECTION, ConfigService],
    },
  ],
  exports: [
    WHATSAPP_TEMPLATE_QUEUE,
    WHATSAPP_TEMPLATE_QUEUE_EVENTS,
    WHATSAPP_WEBHOOK_QUEUE,
  ],
})
export class WhatsappQueueModule {}
