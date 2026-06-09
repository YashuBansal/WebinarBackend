import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';
import { Project, ProjectSchema } from 'src/schemas/project.schema';
import { Contact, ContactSchema } from '../contacts/Contact.schema';
import { FlowExecutionLog, FlowExecutionLogSchema } from './flow-execution-log.schema';
import { AutomationFlow, AutomationFlowSchema } from 'src/automations/schemas/automation-flow.schema';
import { FlowExecutionService } from './flow-execution.service';
import { WhatsappApiModule } from '../whatsapp-api/whatsapp-api.module';
import { BullModule } from '@nestjs/bull';
import { FlowExecutionProcessor } from './flow-execution.processor';
import { CrmFlowExecutionService } from './crm-flow-execution.service';
import { CrmAutomationListener } from './crm-automation.listener';
import { DashboardWebhookController } from './dashboard-webhook.controller';
import { CrmFlowExecutionProcessor } from './crm-flow-execution.processor';
import { AttendeesModule } from '../attendees/attendees.module';
import { GoogleSheetsService } from '../integrations/google-sheets.service';
import { FlowExecutionController } from './flow-execution.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Project.name, schema: ProjectSchema },
      { name: AutomationFlow.name, schema: AutomationFlowSchema },
      { name: Contact.name, schema: ContactSchema },
      { name: FlowExecutionLog.name, schema: FlowExecutionLogSchema },
    ]),
    WhatsappApiModule,
    HttpModule,
    BullModule.registerQueue(
      { name: 'flow-delay-queue' },
      { name: 'crm-flow-execution' }
    ),
    AttendeesModule,
  ],
  controllers: [DashboardWebhookController, FlowExecutionController],
  providers: [
    FlowExecutionService,
    FlowExecutionProcessor,
    CrmFlowExecutionService,
    CrmAutomationListener,
    CrmFlowExecutionProcessor,
    GoogleSheetsService,
  ],
  exports: [FlowExecutionService, CrmFlowExecutionService],
})
export class FlowExecutionModule {}
