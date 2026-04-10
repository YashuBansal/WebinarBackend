import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AutomationsService } from './automations.service';
import { AutomationsController } from './automations.controller';
import {
  AutomationFlow,
  AutomationFlowSchema,
} from './schemas/automation-flow.schema';
import {
  AutomationExecution,
  AutomationExecutionSchema,
} from './schemas/automation-execution.schema';
import { AutomationsProcessor } from './automations.processor';
import { WhatsappModule } from 'src/whatsapp/whatsapp.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AutomationFlow.name, schema: AutomationFlowSchema },
      { name: AutomationExecution.name, schema: AutomationExecutionSchema },
    ]),
    WhatsappModule,
  ],
  controllers: [AutomationsController],
  providers: [AutomationsService, AutomationsProcessor],
  exports: [AutomationsService],
})
export class AutomationsModule {}
