import { forwardRef, MiddlewareConsumer, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ContactsService } from './contacts.service';
import { ContactsController } from './contacts.controller';
import { Contact, ContactSchema } from './Contact.schema';
import { AuthAdminTokenMiddleware } from 'src/middlewares/authAdmin.Middleware';
import { UsersModule } from 'src/users/users.module';
import { WabaTagsModule } from 'src/waba-tags/waba-tags.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Contact.name, schema: ContactSchema }]),
    WabaTagsModule,
  ],
  providers: [ContactsService],
  controllers: [ContactsController],
  exports: [ContactsService],
})
export class ContactsModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthAdminTokenMiddleware).forRoutes(ContactsController);
  }
}
