import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { RedisModule, REDIS_CONNECTION } from 'src/redis/redis.module';

export const PROGRAM_AUTO_ASSIGN_QUEUE = 'PROGRAM_AUTO_ASSIGN_QUEUE';
export const PROGRAM_AUTO_ASSIGN_QUEUE_BASE_NAME = 'program-auto-assign';

// Use same namespace logic as WhatsApp to keep things grouped in Redis cleanly
export const PROGRAM_QUEUE_NAMESPACE_ENV = 'WHATSAPP_QUEUE_NAMESPACE';
const DEFAULT_PROGRAM_QUEUE_NAMESPACE = 'default';

function resolveProgramQueueNamespace(configService?: ConfigService): string {
  const fromConfig = configService?.get<string>(PROGRAM_QUEUE_NAMESPACE_ENV);
  return fromConfig || DEFAULT_PROGRAM_QUEUE_NAMESPACE;
}

export function getProgramQueueNamespace(configService?: ConfigService): string {
  return resolveProgramQueueNamespace(configService);
}

export function getProgramAutoAssignQueueName(configService?: ConfigService): string {
  const namespace = resolveProgramQueueNamespace(configService);
  return `${PROGRAM_AUTO_ASSIGN_QUEUE_BASE_NAME}_${namespace}`;
}

@Module({
  imports: [ConfigModule, RedisModule],
  providers: [
    {
      provide: PROGRAM_AUTO_ASSIGN_QUEUE,
      useFactory: (connection, configService: ConfigService) => {
        const namespace = resolveProgramQueueNamespace(configService);
        const queueName = getProgramAutoAssignQueueName(configService);

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
  exports: [PROGRAM_AUTO_ASSIGN_QUEUE],
})
export class ProgramQueueModule {}
