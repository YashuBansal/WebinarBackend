import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import {
  AutomationExecution,
  AutomationExecutionDocument,
} from './schemas/automation-execution.schema';
import {
  AutomationFlow,
  AutomationFlowDocument,
} from './schemas/automation-flow.schema';
import { WhatsappService } from 'src/whatsapp/whatsapp.service';
import { WabaMessageType } from 'src/whatsapp-embed/waba-message/waba-message.schema';

type FlowGraph = { nodes: Array<any>; edges: Array<any> };

@Injectable()
export class AutomationsProcessor {
  private readonly logger = new Logger(AutomationsProcessor.name);

  constructor(
    @InjectModel(AutomationExecution.name)
    private execModel: Model<AutomationExecutionDocument>,
    @InjectModel(AutomationFlow.name)
    private flowModel: Model<AutomationFlowDocument>,
    private readonly whatsappService: WhatsappService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async resumeDelayedExecutions() {
    const now = new Date();
    const due = await this.execModel
      .find({ status: 'DELAYED', executeAt: { $lte: now } })
      .limit(50);
    for (const exec of due) {
      exec.status = 'RUNNING';
      await exec.save();
      await this.processExecution(exec._id);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processPendingExecutions() {
    const pendings = await this.execModel.find({ status: 'PENDING' }).limit(50);
    for (const exec of pendings) {
      exec.status = 'RUNNING';
      await exec.save();
      await this.processExecution(exec._id);
    }
  }

  private async processExecution(executionId: Types.ObjectId) {
    const exec = await this.execModel.findById(executionId);
    if (!exec) return;
    const flow = await this.flowModel.findById(exec.flowId);
    if (!flow) return;

    const graph = (flow.graph || {}) as FlowGraph;
    const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    const edges = Array.isArray(graph.edges) ? graph.edges : [];

    let currentNodeId = exec.currentNodeId || this.findTriggerNodeId(nodes);
    if (!currentNodeId) {
      await this.complete(exec, 'No trigger node found');
      return;
    }

    // Loop with a max step count to avoid infinite loops
    for (let step = 0; step < 100; step++) {
      const node = nodes.find((n) => `${n.id}` === `${currentNodeId}`);
      if (!node) {
        await this.complete(exec, 'Node not found, completing');
        return;
      }

      try {
        const outcome = await this.handleNode(flow, exec, node);
        if (outcome === 'DELAY') {
          return; // execution parked with executeAt
        }

        // find next edge by default or by handle
        const nextId = this.findNextNodeId(edges, currentNodeId, outcome);
        if (!nextId) {
          await this.complete(exec, 'Flow reached end');
          return;
        }
        currentNodeId = nextId;
        exec.currentNodeId = currentNodeId;
        await exec.save();
      } catch (err) {
        await this.fail(exec, err?.message || 'Node processing failed');
        return;
      }
    }

    await this.fail(exec, 'Max steps exceeded');
  }

  private findTriggerNodeId(nodes: any[]): string | undefined {
    const trigger = nodes.find((n) => n.type === 'trigger:webinar');
    return trigger?.id;
  }

  private findNextNodeId(
    edges: any[],
    currentId: string,
    handle?: 'match' | 'no_match' | 'default',
  ) {
    const fromCurrent = edges.filter((e) => `${e.source}` === `${currentId}`);
    if (handle && handle !== 'default') {
      const specific = fromCurrent.find(
        (e) => `${e.sourceHandle || ''}`.toLowerCase() === handle,
      );
      if (specific) return specific.target;
    }
    return fromCurrent[0]?.target;
  }

  private async handleNode(
    flow: AutomationFlowDocument,
    exec: AutomationExecutionDocument,
    node: any,
  ): Promise<'default' | 'match' | 'no_match' | 'DELAY'> {
    switch (node.type) {
      case 'trigger:webinar':
        return 'default';
      case 'logic:filter': {
        const { rules } = node.data || {};
        const isMatch = this.evaluateRules(
          rules,
          exec.triggerData?.payload || {},
        );
        return isMatch ? 'match' : 'no_match';
      }
      case 'logic:wait': {
        const { amount = 0, unit = 'minutes' } = node.data || {};
        const ms = this.toMs(Number(amount), String(unit));
        exec.status = 'DELAYED';
        exec.executeAt = new Date(Date.now() + ms);
        exec.logs.push({
          timestamp: new Date().toISOString(),
          level: 'info',
          message: `Delaying for ${amount} ${unit}`,
        });
        await exec.save();
        return 'DELAY';
      }
      case 'action:whatsapp': {
        const payload = node.data || {};
        const adminId = `${exec.adminId}`;
        const projectId = `${exec.projectId}`;
        const registrant = exec.triggerData?.payload || {};

        const phone = this.resolvePath(
          registrant,
          payload.phonePath || 'phone',
        );
        const templateName = payload.templateName;
        const variables: string[] = (payload.variables || []).map(
          (v: any) =>
            this.resolvePath(registrant, v?.path || '') || v?.value || '',
        );

        if (!phone || !templateName)
          throw new Error('Missing phone or templateName');

        // Fetch template data from Meta to get the language
        let templateLanguage = 'en_US'; // Default fallback
        try {
          const metaTemplates = await this.whatsappService.getTemplatesForWaba(
            new Types.ObjectId(adminId),
            new Types.ObjectId(projectId),
            { name: templateName },
          );

          if (metaTemplates && metaTemplates.length > 0) {
            const metaTemplate =
              metaTemplates.find((t) => t.name === templateName) ||
              metaTemplates[0];
            templateLanguage = metaTemplate.language || 'en_US';
            this.logger.log(
              `Retrieved template language from Meta: ${templateLanguage} for template: ${templateName}`,
            );
          } else {
            this.logger.warn(
              `Template ${templateName} not found in Meta. Using default language: ${templateLanguage}`,
            );
          }
        } catch (error) {
          this.logger.warn(
            `Failed to fetch template language from Meta for ${templateName}. Using default: ${templateLanguage}`,
            error.message,
          );
        }

        exec.logs.push({
          timestamp: new Date().toISOString(),
          level: 'info',
          message: `WhatsApp sent to ${phone}`,
        });
        await exec.save();
        return 'default';
      }
      default:
        // Unknown node, skip
        exec.logs.push({
          timestamp: new Date().toISOString(),
          level: 'info',
          message: `Skipping unknown node type ${node.type}`,
        });
        await exec.save();
        return 'default';
    }
  }

  private evaluateRules(rules: any, data: any): boolean {
    // very basic AND-only evaluation, can be expanded
    if (!rules || !Array.isArray(rules)) return true;
    return rules.every((r) => {
      const left = this.resolvePath(data, r.field);
      const op = r.operator;
      const right = r.value;
      switch (op) {
        case 'equals':
          return `${left}` == `${right}`;
        case 'not_equals':
          return `${left}` != `${right}`;
        case 'contains':
          return typeof left === 'string' && left.includes(right);
        default:
          return false;
      }
    });
  }

  private toMs(amount: number, unit: string): number {
    switch (unit) {
      case 'minutes':
        return amount * 60 * 1000;
      case 'hours':
        return amount * 60 * 60 * 1000;
      case 'days':
        return amount * 24 * 60 * 60 * 1000;
      default:
        return amount * 1000;
    }
  }

  private resolvePath(obj: any, path: string): any {
    if (!path) return undefined;
    return path
      .split('.')
      .reduce((acc, key) => (acc ? acc[key] : undefined), obj);
  }

  private async complete(exec: AutomationExecutionDocument, message: string) {
    exec.status = 'COMPLETED';
    exec.logs.push({
      timestamp: new Date().toISOString(),
      level: 'info',
      message,
    });
    await exec.save();
  }

  private async fail(exec: AutomationExecutionDocument, message: string) {
    exec.status = 'FAILED';
    exec.logs.push({
      timestamp: new Date().toISOString(),
      level: 'error',
      message,
    });
    await exec.save();
  }
}
