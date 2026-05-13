import { MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { QuickReply, QuickReplySchema } from './schemas/quick-reply.schema';
import { QuickRepliesService } from './quick-replies.service';
import { QuickRepliesController } from './quick-replies.controller';
import { AuthAdminTokenMiddleware } from '../middlewares/authAdmin.Middleware';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: QuickReply.name, schema: QuickReplySchema }]),
  ],
  controllers: [QuickRepliesController],
  providers: [QuickRepliesService],
  exports: [QuickRepliesService],
})
export class QuickRepliesModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthAdminTokenMiddleware)
      .forRoutes(QuickRepliesController);
  }
}
