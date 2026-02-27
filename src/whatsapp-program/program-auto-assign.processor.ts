import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import { ProgramService } from './program.service';
import {
  getProgramAutoAssignQueueName,
  getProgramQueueNamespace,
} from './program.queue.module';
import { REDIS_CONNECTION } from 'src/redis/redis.module';

export interface AutoAssignJobPayload {
  adminId: string;
  type: 'BULK_ASSIGN';
  programId?: string;        // Present if type === 'BULK_ASSIGN'
  eligibleAttendeeIds?: string[]; // Present if type === 'BULK_ASSIGN'
}

@Injectable()
export class ProgramAutoAssignProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProgramAutoAssignProcessor.name);
  private worker: Worker | null = null;

  constructor(
    @Inject(REDIS_CONNECTION)
    private readonly connection: any,
    private readonly configService: ConfigService,
    private readonly programService: ProgramService,
  ) {}

  onModuleInit() {
    const concurrency = this.configService.get<number>('PROGRAM_AUTO_ASSIGN_CONCURRENCY') || 5;

    const workerConnection = this.connection.duplicate();
    const queueName = getProgramAutoAssignQueueName(this.configService);
    const namespace = getProgramQueueNamespace(this.configService);

    this.worker = new Worker(
      queueName,
      async (job) => {
        const payload: AutoAssignJobPayload = job.data;
        
        if (payload.type === 'BULK_ASSIGN') {
          await this.programService.processBulkAutoAssignJob(payload);
        }
      },
      {
        connection: workerConnection,
        concurrency,
        prefix: `bull:${namespace}`,
        removeOnComplete: { age: 24 * 3600 },
        removeOnFail: { count: 1000 },
      },
    );

    this.worker.on('completed', (job) => {
      this.logger.debug(`AutoAssign job ${job.id} processed successfully`);
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `AutoAssign job ${job?.id} failed: ${err?.message}`,
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
