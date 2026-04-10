import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { REDIS_CONNECTION, RedisModule } from 'src/redis/redis.module';

export const CONTACTS_IMPORT_QUEUE = 'CONTACTS_IMPORT_QUEUE';
export const CONTACTS_IMPORT_QUEUE_BASE_NAME = 'contacts-import';
export const CONTACTS_IMPORT_QUEUE_NAMESPACE_ENV = 'WHATSAPP_QUEUE_NAMESPACE';

const DEFAULT_CONTACTS_IMPORT_QUEUE_NAMESPACE = 'default';

function resolveContactsImportQueueNamespace(
  configService?: ConfigService,
): string {
  return (
    configService?.get<string>(CONTACTS_IMPORT_QUEUE_NAMESPACE_ENV) ||
    DEFAULT_CONTACTS_IMPORT_QUEUE_NAMESPACE
  );
}

export function getContactsImportQueueName(
  configService?: ConfigService,
): string {
  const namespace = resolveContactsImportQueueNamespace(configService);
  return `${CONTACTS_IMPORT_QUEUE_BASE_NAME}_${namespace}`;
}

export function getContactsImportQueueNamespace(
  configService?: ConfigService,
): string {
  return resolveContactsImportQueueNamespace(configService);
}

@Module({
  imports: [ConfigModule, RedisModule],
  providers: [
    {
      provide: CONTACTS_IMPORT_QUEUE,
      useFactory: (connection, configService: ConfigService) => {
        const namespace = resolveContactsImportQueueNamespace(configService);
        const queueName = getContactsImportQueueName(configService);
        return new Queue(queueName, {
          connection,
          prefix: `bull:${namespace}`,
          defaultJobOptions: {
            removeOnComplete: { age: 24 * 60 * 60 },
            removeOnFail: false,
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
  exports: [CONTACTS_IMPORT_QUEUE],
})
export class ContactsImportQueueModule {}
