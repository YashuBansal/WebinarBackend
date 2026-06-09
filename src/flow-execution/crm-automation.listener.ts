import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { AutomationFlow, AutomationFlowDocument } from 'src/automations/schemas/automation-flow.schema';
import { CrmFlowExecutionService } from './crm-flow-execution.service';

export interface CrmAutomationEventPayload {
  eventType: string;
  projectId: string;
  data: any;
  triggerNodeId?: string;
}

@Injectable()
export class CrmAutomationListener {
  private readonly logger = new Logger(CrmAutomationListener.name);

  constructor(
    @InjectModel(AutomationFlow.name)
    private readonly automationFlowModel: Model<AutomationFlowDocument>,
    private readonly crmFlowExecutionService: CrmFlowExecutionService,
    @InjectQueue('crm-flow-execution')
    private readonly crmQueue: Queue,
  ) { }

  @OnEvent('automation.trigger')
  async handleAutomationTrigger(event: CrmAutomationEventPayload) {
    try {
      const { eventType, projectId, data } = event;
      this.logger.log(`Received internal trigger event "${eventType}" for project: ${projectId}`);

      // Wapas sirf Active flows aur specific Project ID dhoondhiye
      const activeFlows = await this.automationFlowModel.find({
        _id: event.projectId,
        status: 'active'
      });

      this.logger.log(`Found ${activeFlows.length} active flows for this project in DB`);

      if (!activeFlows || activeFlows.length === 0) {
        this.logger.debug(`No active flows found for project ID: ${projectId}`);
        return;
      }

      // 2. Match flows where the entry trigger type matches the eventType
      const matchedFlows = activeFlows.filter((flow) => {
        const graph = flow.graph;
        if (!graph || !Array.isArray(graph.nodes)) return false;

        const triggerNode = graph.nodes.find((node: any) => node.type === 'trigger');
        if (!triggerNode) return false;

        const triggerType = triggerNode.data?.triggerType || triggerNode.data?.selectedTrigger;
        return triggerType === eventType;
      });

      this.logger.log(`Found ${matchedFlows.length} matched active flow(s) for event type "${eventType}"`);

      // 3. Traversal Execution via Queue
      for (const flow of matchedFlows) {
        await this.crmQueue.add('execute-flow', {
          projectId: String((flow as any)._id), // the actual _id of the flow as requested
          flowId: String((flow as any)._id),
          triggerData: data,
          triggerNodeId: event.triggerNodeId || '',
        }, {
          attempts: 3, // Auto-retry on failure
          backoff: { type: 'exponential', delay: 5000 }, // Wait 5s, 10s, 20s before retrying
          removeOnComplete: true, // Keep Redis clean
        });
        this.logger.log(`[CRM Engine] Added flow execution to Queue for flow: ${(flow as any)._id}`);
      }
    } catch (error) {
      this.logger.error(
        'Error handling CRM automation trigger event:',
        error instanceof Error ? error.stack : error,
      );
    }
  }
}
