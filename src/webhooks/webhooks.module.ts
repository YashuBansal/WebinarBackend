import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { AutomationsModule } from 'src/automations/automations.module';
import { MongooseModule } from '@nestjs/mongoose';
import { AutomationFlow, AutomationFlowSchema } from 'src/automations/schemas/automation-flow.schema';

@Module({
  imports: [
    AutomationsModule,
    MongooseModule.forFeature([
      { name: AutomationFlow.name, schema: AutomationFlowSchema },
    ]),
  ],
  controllers: [WebhooksController],
})
export class WebhooksModule {}


