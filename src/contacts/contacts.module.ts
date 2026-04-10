import { MiddlewareConsumer, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ContactsService } from './contacts.service';
import { ContactsController } from './contacts.controller';
import { Contact, ContactSchema } from './Contact.schema';
import {
  ContactImportHistory,
  ContactImportHistorySchema,
} from './ContactImportHistory.schema';
import { ContactsImportQueueModule } from './contacts-import.queue.module';
import { ContactsImportProcessor } from './contacts-import.processor';
import { AuthAdminTokenMiddleware } from 'src/middlewares/authAdmin.Middleware';
import { WabaTagsModule } from 'src/waba-tags/waba-tags.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Contact.name, schema: ContactSchema },
      { name: ContactImportHistory.name, schema: ContactImportHistorySchema },
    ]),
    ContactsImportQueueModule,
    WabaTagsModule,
  ],
  providers: [ContactsService, ContactsImportProcessor],
  controllers: [ContactsController],
  exports: [ContactsService],
})
export class ContactsModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthAdminTokenMiddleware).forRoutes(ContactsController);
  }
}
