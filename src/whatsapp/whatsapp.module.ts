import {
  forwardRef,
  MiddlewareConsumer,
  Module,
  RequestMethod,
} from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { HttpModule } from '@nestjs/axios';
import { UsersModule } from 'src/users/users.module';
import { WhatsappController } from './whatsapp.controller';
import { ProjectsModule } from 'src/projects/projects.module';
import { AuthAdminTokenMiddleware } from 'src/middlewares/authAdmin.Middleware';
import { MongooseModule } from '@nestjs/mongoose';
import { MediaAsset, MediaAssetSchema } from './schemas/media-asset.schema';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';
import { WabaMessageModule } from 'src/whatsapp-embed/waba-message/waba-message.module';
import { ContactsModule } from 'src/contacts/contacts.module';
import { FileStorageService } from 'src/file-storage/file-storage.service';
import { WebsocketModule } from 'src/websocket/websocket.module';
import { WhatsappQueueModule } from './whatsapp.queue.module';
import { WhatsappQueueProcessor } from './whatsapp.queue.processor';
import { WhatsappWebhookProcessor } from './whatsapp.webhook.processor';
import { WabaTemplateModule } from 'src/whatsapp-embed/waba-template/waba-template.module';
import { ChatbotTriggerModule } from 'src/chatbot-trigger/chatbot-trigger.module';
import { ChatbotTriggerController } from 'src/chatbot-trigger/chatbot-trigger.controller';
import { WhatsappOptoutModule } from 'src/whatsapp-optout/whatsapp-optout.module';
import { SubscriptionModule } from 'src/subscription/subscription.module';

import { QuickReply, QuickReplySchema } from 'src/quick-replies/schemas/quick-reply.schema';

@Module({
  imports: [
    HttpModule,
    forwardRef(() => UsersModule),
    forwardRef(() => SubscriptionModule),
    ProjectsModule,
    WabaMessageModule,
    ContactsModule,
    WebsocketModule,
    MongooseModule.forFeature([
      { name: MediaAsset.name, schema: MediaAssetSchema },
      { name: QuickReply.name, schema: QuickReplySchema },
    ]),
    WhatsappQueueModule,
    forwardRef(() => WabaTemplateModule),
    ChatbotTriggerModule,
    WhatsappOptoutModule,
  ],
  providers: [
    WhatsappService,
    CloudinaryService,
    FileStorageService,
    WhatsappQueueProcessor,
    WhatsappWebhookProcessor,
  ],
  exports: [WhatsappService],
  controllers: [WhatsappController],
})
export class WhatsappModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthAdminTokenMiddleware)
      .exclude({ path: 'whatsapp/webhook', method: RequestMethod.ALL })
      .forRoutes(WhatsappController, ChatbotTriggerController);
  }
}
