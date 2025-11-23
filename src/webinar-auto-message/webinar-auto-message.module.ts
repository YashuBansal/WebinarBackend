import {
  MiddlewareConsumer,
  Module,
  RequestMethod,
  forwardRef,
} from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  WebinarAutoMessage,
  WebinarAutoMessageSchema,
} from './webinar-auto-message.schema';
import { WebinarAutoMessageService } from './webinar-auto-message.service';
import { WebinarAutoMessageController } from './webinar-auto-message.controller';
import { WhatsappModule } from 'src/whatsapp/whatsapp.module';
import { ProjectsModule } from 'src/projects/projects.module';
import { WabaMessageModule } from 'src/whatsapp-embed/waba-message/waba-message.module';
import { AuthAdminTokenMiddleware } from 'src/middlewares/authAdmin.Middleware';
import { UsersModule } from 'src/users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WebinarAutoMessage.name, schema: WebinarAutoMessageSchema },
    ]),
    forwardRef(() => UsersModule),
    forwardRef(() => WhatsappModule),
    forwardRef(() => ProjectsModule),
  ],
  controllers: [WebinarAutoMessageController],
  providers: [WebinarAutoMessageService],
  exports: [WebinarAutoMessageService],
})
export class WebinarAutoMessageModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthAdminTokenMiddleware)
      .forRoutes(WebinarAutoMessageController);
  }
}
