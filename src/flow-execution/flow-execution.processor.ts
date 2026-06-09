import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { FlowExecutionService } from './flow-execution.service';

export interface FlowDelayJobPayload {
  wabaAccountId: string;
  customerPhone: string;
  messagePayload: string;
  nextNodeId: string;
}

@Processor('flow-delay-queue')
export class FlowExecutionProcessor {
  private readonly logger = new Logger(FlowExecutionProcessor.name);

  constructor(private readonly flowExecutionService: FlowExecutionService) {}

  @Process('resume-flow')
  async handleResumeFlow(job: Job<FlowDelayJobPayload>) {
    const { wabaAccountId, customerPhone, messagePayload, nextNodeId } = job.data;

    this.logger.log(
      `Resuming delayed execution for customer ${customerPhone} starting at node ${nextNodeId}`
    );

    try {
      await this.flowExecutionService.processIncomingMessage(
        wabaAccountId,
        customerPhone,
        messagePayload,
        nextNodeId,
      );
    } catch (error) {
      this.logger.error(
        `Failed to process resumed execution for customer ${customerPhone} at node ${nextNodeId}:`,
        error instanceof Error ? error.stack : error
      );
    }
  }
}
