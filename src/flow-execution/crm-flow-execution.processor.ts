import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { CrmFlowExecutionService } from './crm-flow-execution.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FlowExecutionLog, FlowExecutionLogDocument } from './flow-execution-log.schema';

@Processor('crm-flow-execution')
export class CrmFlowExecutionProcessor {
  private readonly logger = new Logger(CrmFlowExecutionProcessor.name);

  constructor(
    private readonly crmFlowExecutionService: CrmFlowExecutionService,
    @InjectModel(FlowExecutionLog.name)
    private readonly flowExecutionLogModel: Model<FlowExecutionLogDocument>,
  ) {}

  @Process('execute-flow')
  async handleFlowExecution(job: Job) {
    this.logger.log(`[CRM Worker] Processing flow job ${job.id}`);
    const { flowId, projectId, triggerData, triggerNodeId, contextResponses } = job.data;
    
    // Fallback if flowId was passed as projectId
    const targetFlowId = flowId || projectId;

    try {
      await this.crmFlowExecutionService.startExecution(targetFlowId, triggerData, triggerNodeId, contextResponses);
      this.logger.log(`[CRM Worker] Completed processing flow job ${job.id}`);

      // Save success log
      await this.flowExecutionLogModel.create({
        flowId: targetFlowId,
        projectId: projectId || targetFlowId,
        status: 'success',
        jobId: String(job.id),
        logs: { triggerData, triggerNodeId, contextResponses }
      });
    } catch (error: any) {
      this.logger.error(
        `[CRM Worker] Failed to process flow job ${job.id} for flow ${targetFlowId}:`,
        error instanceof Error ? error.stack : error
      );

      // Save failure log
      await this.flowExecutionLogModel.create({
        flowId: targetFlowId,
        projectId: projectId || targetFlowId,
        status: 'failed',
        jobId: String(job.id),
        error: error.message,
        logs: { triggerData, triggerNodeId, contextResponses, stack: error.stack }
      });

      throw error;
    }
  }
}
