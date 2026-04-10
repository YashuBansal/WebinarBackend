import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import { REDIS_CONNECTION } from 'src/redis/redis.module';
import { ContactsService } from './contacts.service';
import {
  getContactsImportQueueName,
  getContactsImportQueueNamespace,
} from './contacts-import.queue.module';

export interface ContactsImportJobData {
  importHistoryId: string;
}

@Injectable()
export class ContactsImportProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ContactsImportProcessor.name);
  private worker: Worker<ContactsImportJobData> | null = null;

  constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: any,
    private readonly configService: ConfigService,
    private readonly contactsService: ContactsService,
  ) {}

  onModuleInit() {
    const concurrency =
      this.configService.get<number>('CONTACTS_IMPORT_QUEUE_CONCURRENCY') || 2;
    const queueName = getContactsImportQueueName(this.configService);
    const namespace = getContactsImportQueueNamespace(this.configService);
    const workerConnection = this.connection.duplicate();

    this.worker = new Worker<ContactsImportJobData>(
      queueName,
      async (job: Job<ContactsImportJobData>) => {
        await this.contactsService.processBulkImportJob(job.data.importHistoryId);
      },
      {
        connection: workerConnection,
        concurrency,
        prefix: `bull:${namespace}`,
        lockDuration: 10 * 60 * 1000,
      },
    );

    this.worker.on('completed', (job) => {
      this.logger.log(`Contacts import job ${job.id} completed`);
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Contacts import job ${job?.id} failed: ${err?.message}`,
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
