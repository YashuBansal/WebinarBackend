import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Project, ProjectDocument } from 'src/schemas/project.schema';
import { AutomationFlow, AutomationFlowDocument } from 'src/automations/schemas/automation-flow.schema';
import { WhatsappApiService } from '../whatsapp-api/whatsapp-api.service';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

@Injectable()
export class FlowExecutionService {
  private readonly logger = new Logger(FlowExecutionService.name);

  constructor(
    @InjectModel(Project.name)
    private readonly projectModel: Model<ProjectDocument>,
    @InjectModel(AutomationFlow.name)
    private readonly automationFlowModel: Model<AutomationFlowDocument>,
    private readonly whatsappApiService: WhatsappApiService,
    @InjectQueue('flow-delay-queue')
    private readonly delayQueue: Queue,
  ) {}

  /**
   * Helper to mask PII for secure logging.
   */
  private maskPhone(phone: string): string {
    if (!phone) return '***';
    const clean = phone.replace(/[^0-9]/g, '');
    if (clean.length > 5) {
      return `${clean.substring(0, 3)}*****${clean.substring(clean.length - 3)}`;
    }
    return '***';
  }

  /**
   * 1. Active Flow Lookup
   * Query the MongoDB Project collection to resolve the projectId,
   * then query AutomationFlow where status === 'active' for that projectId.
   */
  async getActiveFlow(wabaAccountId: string): Promise<AutomationFlow | null> {
    const project = await this.projectModel.findOne({
      phoneNumberId: wabaAccountId,
      isDeleted: { $ne: true },
    }).exec();

    if (!project) {
      this.logger.warn(`No active project found for WABA Account ID: ${wabaAccountId}`);
      return null;
    }

    const flow = await this.automationFlowModel.findOne({
      projectId: project._id,
      status: 'active',
    }).exec();

    if (!flow) {
      this.logger.debug(`No active automation flow found for project ID: ${project._id}`);
      return null;
    }

    return flow;
  }

  /**
   * 2. DAG Traversal Utility: Find trigger node
   */
  getEntryNode(graph: any): any | null {
    if (!graph || !Array.isArray(graph.nodes)) return null;
    return graph.nodes.find((node: any) => node.type === 'trigger') || null;
  }

  /**
   * 2. DAG Traversal Utility: Get node by ID
   */
  getNodeById(graph: any, nodeId: string): any | null {
    if (!graph || !Array.isArray(graph.nodes)) return null;
    return graph.nodes.find((node: any) => node.id === nodeId) || null;
  }

  /**
   * 2. DAG Traversal Utility: Get outgoing edges
   */
  getNextNodeEdges(graph: any, sourceNodeId: string): any[] {
    if (!graph || !Array.isArray(graph.edges)) return [];
    return graph.edges.filter((edge: any) => edge.source === sourceNodeId);
  }

  /**
   * 2. DAG Traversal Utility: Determine target node ID
   */
  determineNextRoute(graph: any, sourceNodeId: string, sourceHandleId?: string): string | null {
    if (!graph || !Array.isArray(graph.edges)) return null;

    let edge;
    if (sourceHandleId) {
      edge = graph.edges.find(
        (e: any) => e.source === sourceNodeId && e.sourceHandle === sourceHandleId
      );
    }

    if (!edge) {
      edge = graph.edges.find((e: any) => e.source === sourceNodeId);
    }

    return edge ? edge.target : null;
  }

  /**
   * Node Execution Runner
   * Executes the specific logic of an action or condition node.
   */
  async executeNodeAction(
    node: any,
    context: { wabaAccountId: string; customerPhone: string; incomingMessage: string },
  ): Promise<string | undefined> {
    const actionType = node.data?.actionType || node.type;

    switch (actionType) {
      case 'whatsapp_send_approved_template': {
        const templateName = node.data?.templateName || node.data?.template_name;
        const variables = node.data?.variables || node.data?.variableMapping || {};
        if (!templateName) {
          this.logger.warn(`Action node ${node.id} is missing templateName.`);
          throw new Error(`Action node ${node.id} is missing templateName.`);
        }
        
        // Dynamic fetch of permanentAccessToken for this WABA account to guarantee dynamic credentials
        const project = await this.projectModel.findOne({
          phoneNumberId: context.wabaAccountId,
          isDeleted: { $ne: true }
        }).exec();

        if (!project || !project.permanentAccessToken) {
          throw new Error(`Missing permanentAccessToken for WABA Account ID ${context.wabaAccountId}`);
        }

        // whatsappApiService handles timeout, sanitization, and verification
        await this.whatsappApiService.sendTemplateMessage(
          context.wabaAccountId,
          context.customerPhone,
          templateName,
          variables,
          project.permanentAccessToken
        );
        return;
      }

      case 'condition': {
        const incomingText = String(context.incomingMessage || '').toLowerCase().trim();
        const conditionValue = String(node.data?.conditionValue || node.data?.value || '').toLowerCase().trim();
        const conditionOperator = node.data?.operator || 'equals';

        let isMatch = false;
        if (conditionOperator === 'contains') {
          isMatch = incomingText.includes(conditionValue);
        } else {
          isMatch = incomingText === conditionValue;
        }

        const result = isMatch ? 'true' : 'false';
        this.logger.log(`Evaluated condition node ${node.id}: result is "${result}" (Operator: ${conditionOperator}, Expected: ${conditionValue})`);
        return result;
      }

      default:
        throw new NotImplementedException(`Unhandled action type in WABA execution engine: ${actionType}`);
    }
  }

  /**
   * 3. The Execution Entry Pipeline & Recursive traverser
   * Fetch active flow, find trigger node, traverse and execute each connected node.
   */
  async processIncomingMessage(
    wabaAccountId: string,
    customerPhone: string,
    messagePayload: string,
    startNodeId?: string,
  ): Promise<void> {
    try {
      const maskedPhone = this.maskPhone(customerPhone);
      this.logger.log(`Starting WABA execution pipeline for customer: ${maskedPhone}`);

      // 1. Fetch the active flow. If none exists, abort gracefully.
      const flow = await this.getActiveFlow(wabaAccountId);
      if (!flow) {
        this.logger.log(`Aborting: No active flow found for WABA Account ID ${wabaAccountId}`);
        return;
      }

      const graph = flow.graph;
      if (!graph) {
        this.logger.warn(`Active flow ${(flow as any)._id} does not contain a graph object.`);
        return;
      }

      let currentNodeId: string | null = null;

      if (startNodeId) {
        this.logger.log(`Resuming WABA flow execution from node: ${startNodeId}`);
        currentNodeId = startNodeId;
      } else {
        // 2. Locate the trigger node.
        const triggerNode = this.getEntryNode(graph);
        if (!triggerNode) {
          this.logger.warn(`Active flow ${(flow as any)._id} is missing a trigger node.`);
          return;
        }

        // 3. Traverse to the next node immediately connected to the trigger.
        const nextNodeId = this.determineNextRoute(graph, triggerNode.id);
        if (!nextNodeId) {
          this.logger.log(`Trigger node ${triggerNode.id} has no connected downstream nodes.`);
          return;
        }

        const firstActionNode = this.getNodeById(graph, nextNodeId);
        if (!firstActionNode) {
          this.logger.warn(`Connected target node ${nextNodeId} not found in the graph.`);
          return;
        }

        this.logger.log(`Starting execution. First node ID: ${firstActionNode.id} Type: ${firstActionNode.type}`);
        currentNodeId = nextNodeId;
      }

      let stepsCount = 0;

      // Loop over nodes sequentially
      while (currentNodeId) {
        // Cyclic graph protection / runaway execution preventer
        stepsCount++;
        if (stepsCount > 50) {
          throw new Error('[WABA Engine] Infinite loop execution aborted: exceeded maximum step threshold of 50.');
        }

        const currentNode = this.getNodeById(graph, currentNodeId);
        if (!currentNode) {
          this.logger.warn(`Node ID ${currentNodeId} not found in the graph during traversal.`);
          break;
        }

        this.logger.log(`Executing step ${stepsCount} (Node ID: ${currentNode.id}, Type: ${currentNode.type})`);

        // Handle delay nodes
        if (currentNode.type === 'delay') {
          this.logger.log('Delay node encountered, pausing execution');

          const amount = parseInt(currentNode.data?.amount || currentNode.data?.delayAmount || '0', 10);
          const unit = String(currentNode.data?.unit || currentNode.data?.delayUnit || 'minutes').toLowerCase();

          let delayInMilliseconds = amount * 1000; // Default: seconds
          if (unit.startsWith('minute')) {
            delayInMilliseconds = amount * 60 * 1000;
          } else if (unit.startsWith('hour')) {
            delayInMilliseconds = amount * 60 * 60 * 1000;
          } else if (unit.startsWith('day')) {
            delayInMilliseconds = amount * 24 * 60 * 60 * 1000;
          }

          const nextNodeIdAfterDelay = this.determineNextRoute(graph, currentNode.id);

          if (nextNodeIdAfterDelay) {
            this.logger.log(`Scheduling resume-flow job for customer ${maskedPhone} in ${delayInMilliseconds}ms`);
            await this.delayQueue.add(
              'resume-flow',
              {
                wabaAccountId,
                customerPhone,
                messagePayload,
                nextNodeId: nextNodeIdAfterDelay,
              },
              {
                delay: delayInMilliseconds,
              },
            );
          } else {
            this.logger.log('Delay node has no downstream targets, execution ends here.');
          }

          break; // Stop execution loop for now
        }

        let sourceHandleId: string | undefined = undefined;

        // Execute node if it is action or condition
        if (currentNode.type === 'action' || currentNode.type === 'condition') {
          const result = await this.executeNodeAction(currentNode, {
            wabaAccountId,
            customerPhone,
            incomingMessage: messagePayload,
          });

          if (currentNode.type === 'condition') {
            sourceHandleId = result;
          }
        }

        // Determine next route
        const nextId = this.determineNextRoute(graph, currentNode.id, sourceHandleId);
        if (!nextId) {
          this.logger.log('Execution flow completed');
          break;
        }

        currentNodeId = nextId;
      }
    } catch (error: any) {
      this.logger.error(
        'Error in processIncomingMessage pipeline:',
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }
}
