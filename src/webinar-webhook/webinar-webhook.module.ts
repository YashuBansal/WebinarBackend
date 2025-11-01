import {
  forwardRef,
  MiddlewareConsumer,
  Module,
  RequestMethod,
} from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WebinarWebhookController } from './webinar-webhook.controller';
import { WebinarWebhookService } from './webinar-webhook.service';
import {
  WebinarWebhook,
  WebinarWebhookSchema,
} from './schemas/webinar-webhook.schema';
import { AuthAdminTokenMiddleware } from 'src/middlewares/authAdmin.Middleware';
import { UsersModule } from 'src/users/users.module';
import { ConfigModule } from '@nestjs/config';
import { AssignmentModule } from 'src/assignment/assignment.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: WebinarWebhook.name,
        schema: WebinarWebhookSchema,
      },
    ]),
    forwardRef(() => UsersModule),
    forwardRef(() => AssignmentModule),
    ConfigModule,
  ],
  controllers: [WebinarWebhookController],
  providers: [WebinarWebhookService],
  exports: [WebinarWebhookService],
})
export class WebinarWebhookModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthAdminTokenMiddleware)
      .exclude(
        { path: 'webinar-webhook/receive/:token', method: RequestMethod.POST },
      )
      .forRoutes(WebinarWebhookController);
  }
}
