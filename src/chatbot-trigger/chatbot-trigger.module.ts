import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatbotTrigger, ChatbotTriggerSchema } from './chatbot-trigger.schema';
import { ChatbotTriggerService } from './chatbot-trigger.service';
import { ChatbotTriggerController } from './chatbot-trigger.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ChatbotTrigger.name, schema: ChatbotTriggerSchema },
    ]),
  ],
  controllers: [ChatbotTriggerController],
  providers: [ChatbotTriggerService],
  exports: [ChatbotTriggerService],
})
export class ChatbotTriggerModule {}
