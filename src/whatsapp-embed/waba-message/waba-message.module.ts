import { forwardRef, MiddlewareConsumer, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WabaMessageService } from './waba-message.service';
import {
  WabaMessage,
  WabaMessageSchema,
} from './waba-message.schema';
import {
  ChatReadStatus,
  ChatReadStatusSchema,
} from './chat-read-status.schema';
import { WabaMessageController } from './waba-message.controller';
import { AuthAdminTokenMiddleware } from 'src/middlewares/authAdmin.Middleware';
import { UsersModule } from 'src/users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WabaMessage.name, schema: WabaMessageSchema },
      { name: ChatReadStatus.name, schema: ChatReadStatusSchema },
    ]),
    forwardRef(() => UsersModule),
  ],
  providers: [WabaMessageService],
  controllers: [WabaMessageController],
  exports: [WabaMessageService],
})
export class WabaMessageModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthAdminTokenMiddleware).forRoutes(WabaMessageController);
  }
}
