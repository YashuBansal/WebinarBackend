import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Project, ProjectDocument } from 'src/schemas/project.schema';
import { AutomationFlow, AutomationFlowDocument } from 'src/automations/schemas/automation-flow.schema';
import { WhatsappApiService } from '../whatsapp-api/whatsapp-api.service';
import { AttendeesService } from '../attendees/attendees.service';
import { lastValueFrom } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { GoogleSheetsService } from '../integrations/google-sheets.service';
import { Queue } from 'bull';
import { InjectQueue } from '@nestjs/bull';
import { Contact, ContactDocument } from '../contacts/Contact.schema';
import { FlowExecutionLog, FlowExecutionLogDocument } from './flow-execution-log.schema';

export interface CrmExecutionContext {
  projectId: string;
  triggerData: any;
  responses: Record<string, any>;
  stepsCount: number;
}

@Injectable()
export class CrmFlowExecutionService {
  private readonly logger = new Logger(CrmFlowExecutionService.name);

  constructor(
    private readonly whatsappApiService: WhatsappApiService,
    @InjectModel(Project.name)
    private readonly projectModel: Model<ProjectDocument>,
    @InjectModel(AutomationFlow.name)
    private readonly automationFlowModel: Model<AutomationFlowDocument>,
    @InjectModel(Contact.name)
    private readonly contactModel: Model<ContactDocument>,
    private readonly attendeesService: AttendeesService,
    private readonly httpService: HttpService,
    private readonly googleSheetsService: GoogleSheetsService,
    @InjectQueue('crm-flow-execution') private crmQueue: Queue,
    @InjectModel(FlowExecutionLog.name)
    private readonly flowExecutionLogModel: Model<FlowExecutionLogDocument>,
  ) { }

  /**
   * Helper to mask PII (email, phone, etc.) for secure logging.
   */
  private maskPII(value: string): string {
    if (!value) return '***';
    const clean = String(value).trim();
    if (clean.includes('@')) {
      const [local, domain] = clean.split('@');
      return `${local.substring(0, Math.min(2, local.length))}***@${domain}`;
    }
    // Phone or ID mask
    const numeric = clean.replace(/[^0-9]/g, '');
    if (numeric.length > 5) {
      return `${numeric.substring(0, 3)}*****${numeric.substring(numeric.length - 3)}`;
    }
    return '***';
  }

  /**
   * DAG Traversal Utility: Find trigger node
   */
  getEntryNode(graph: any): any | null {
    if (!graph || !Array.isArray(graph.nodes)) return null;
    return graph.nodes.find((node: any) => node.type === 'trigger') || null;
  }

  /**
   * DAG Traversal Utility: Get node by ID
   */
  getNodeById(graph: any, nodeId: string): any | null {
    if (!graph || !Array.isArray(graph.nodes)) return null;
    return graph.nodes.find((node: any) => node.id === nodeId) || null;
  }

  /**
   * DAG Traversal Utility: Determine target node ID
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
   * Helper to evaluate dynamic conditions
   */
  private evaluateCondition(operator: string, leftOperand: any, rightOperand: any): boolean {
    const left = leftOperand === null || leftOperand === undefined ? '' : String(leftOperand);
    const right = rightOperand === null || rightOperand === undefined ? '' : String(rightOperand);

    switch (operator) {
      case 'exists':
        return left !== '';
      case 'not_exists':
      case 'does_not_exist':
        return left === '';
      case 'equals':
      case 'equal_to':
        return left.toLowerCase() === right.toLowerCase();
      case 'not_equals':
      case 'not_equal_to':
        return left.toLowerCase() !== right.toLowerCase();
      case 'greater_than':
        return Number(left) > Number(right);
      case 'smaller_than':
        return Number(left) < Number(right);
      case 'contains':
      case 'contains_string':
        return left.toLowerCase().includes(right.toLowerCase());
      case 'starts_with':
        return left.toLowerCase().startsWith(right.toLowerCase());
      case 'ends_with':
        return left.toLowerCase().endsWith(right.toLowerCase());
      default:
        return false;
    }
  }

  /**
   * Helper to parse handlebar-like dynamic placeholders (e.g. {{phone}} or {{1.from}} or {{action_123.messageId}})
   * using contextData fields and previous node responses.
   */
  private parseDynamicVariables(text: string, context: CrmExecutionContext): string {
    if (!text) return '';
    try {
      const contextData = context.triggerData;
      return text.replace(/\{\{(.*?)\}\}/g, (match, path) => {
        const cleanPath = path.trim();

        // Check if path references a previous node's output (e.g. action_123.messageId)
        if (cleanPath.includes('.')) {
          const parts = cleanPath.split('.');
          const firstPart = parts[0];

          // If the first part matches a recorded node response
          if (context.responses && context.responses[firstPart] !== undefined) {
            let current = context.responses[firstPart];
            for (let i = 1; i < parts.length; i++) {
              if (current && typeof current === 'object' && current[parts[i]] !== undefined) {
                current = current[parts[i]];
              } else {
                current = undefined;
                break;
              }
            }
            if (current !== undefined) {
              return String(current);
            }
          }
        }

        // 1. Direct match in triggerData (e.g. contextData['1.from'])
        if (contextData && contextData[cleanPath] !== undefined) {
          return String(contextData[cleanPath]);
        }

        // 2. Nested dot lookup in triggerData (e.g. contextData['1']['from'])
        if (cleanPath.includes('.')) {
          const parts = cleanPath.split('.');
          let current = contextData;
          for (const part of parts) {
            if (current && typeof current === 'object' && current[part] !== undefined) {
              current = current[part];
            } else {
              current = undefined;
              break;
            }
          }
          if (current !== undefined) {
            return String(current);
          }

          // Fallback to last property name in triggerData (e.g. contextData['from'])
          const lastPart = parts[parts.length - 1];
          if (contextData && contextData[lastPart] !== undefined) {
            return String(contextData[lastPart]);
          }
        }

        this.logger.warn(`Could not resolve dynamic variable placeholder: ${cleanPath}`);
        return '';
      });
    } catch (err: any) {
      this.logger.error(`Error parsing dynamic variables in text "${text}": ${err.message}`);
      return '';
    }
  }

  /**
   * Executes the action of a CRM node based on its actionType.
   */
  async executeCrmNode(node: any, context: CrmExecutionContext): Promise<any> {
    const actionType = node.data?.actionType || node.type;

    switch (actionType) {

      case 'add_to_webinar': {
        const webinarId = node.data?.webinarId;
        if (!webinarId) {
          throw new Error(`[CRM Engine] Missing webinarId in add_to_webinar action.`);
        }

        const rawFirstName = node.data?.webinarFirstName || '';
        const rawLastName = node.data?.webinarLastName || '';
        const rawEmail = node.data?.webinarEmail || '';
        const rawPhone = node.data?.webinarPhone || '';

        const firstName = this.parseDynamicVariables(rawFirstName, context) || context.triggerData?.first_name || '';
        const lastName = this.parseDynamicVariables(rawLastName, context) || context.triggerData?.last_name || '';
        const email = this.parseDynamicVariables(rawEmail, context) || context.triggerData?.email || '';
        const phone = this.parseDynamicVariables(rawPhone, context) || context.triggerData?.phone || '';

        if (!email) {
          throw new Error(`[CRM Engine] Missing email for webinar registration.`);
        }

        this.logger.log(`[CRM Engine] Registering ${this.maskPII(email)} to webinar ${webinarId}`);

        const result = await this.attendeesService.upsertAttendeeByWebinarEmailNotAttended({
          webinarId,
          adminId: context.projectId,
          email,
          firstName,
          lastName,
          phone,
          source: 'crm_automation',
        });

        this.logger.log(`[CRM Engine] Webinar registration successful: ${result.action}`);
        return { status: 'success', action: result.action, attendeeId: result.attendee?._id };
      }
      case 'send_whatsapp': {
        const rawPhone = node.data?.whatsappPhone || node.data?.recipient || '';
        let phoneNumber = this.parseDynamicVariables(rawPhone, context);
        if (!phoneNumber) {
          phoneNumber = context.triggerData?.phone || '';
        }

        const templateName = node.data?.templateName || node.data?.template_name || node.data?.selectedTemplate;
        const variables = node.data?.variables || node.data?.variableMapping || {};

        // Dynamic parsing of template variables
        const parsedVariables: Record<string, string> = {};
        for (const [key, val] of Object.entries(variables)) {
          parsedVariables[key] = this.parseDynamicVariables(String(val), context);
        }

        // Fetch WABA credentials dynamically from the Project model
        const project = await this.projectModel.findById(context.projectId).exec();
        if (!project || !project.phoneNumberId || !project.permanentAccessToken) {
          this.logger.error(`[CRM Engine] Missing WABA credentials in Project ${context.projectId}`);
          throw new Error('Meta Graph API call failed: WABA credentials missing in Project model');
        }

        this.logger.log('[CRM Engine] Dynamically fetched WABA credentials from Project model.');
        
        const maskedPhone = this.maskPII(phoneNumber);
        this.logger.log(`[CRM Engine] Dispatching WhatsApp Template: ${templateName} to ${maskedPhone}`);

        // The sendTemplateMessage method handles sanitization, validation, and Axios timeouts internally.
        const apiResponse = await this.whatsappApiService.sendTemplateMessage(
          project.phoneNumberId,
          phoneNumber,
          templateName,
          parsedVariables,
          project.permanentAccessToken,
        );
        
        this.logger.log(`[CRM Engine] WhatsApp dispatched successfully to ${maskedPhone}.`);
        return { status: 'success', messageId: apiResponse?.messages?.[0]?.id || 'unknown' };
      }

      case 'add_to_google_sheet': {
        const spreadsheetId = node.data?.spreadsheet;
        const worksheet = node.data?.worksheet || 'Sheet1';
        const columnMappings = node.data?.columnMappings || {};

        if (!spreadsheetId) {
          throw new Error(`[CRM Engine] Missing spreadsheet ID for Google Sheets action.`);
        }

        const rowData: string[] = [];

        // It is assumed columnMappings is an object with column headers as keys and dynamic variable strings as values.
        // E.g. { "Name": "{{1.Name}}", "Phone": "{{1.Phone}}" }
        for (const [key, rawValue] of Object.entries(columnMappings)) {
          const parsedValue = this.parseDynamicVariables(String(rawValue || ''), context);
          rowData.push(parsedValue);
        }

        this.logger.log(`[CRM Engine] Appending row to Google Sheet ${spreadsheetId} / ${worksheet}`);

        try {
          const result = await this.googleSheetsService.appendRowToSheet(spreadsheetId, worksheet, rowData);
          this.logger.log(`[CRM Engine] Appended to Google Sheet successfully.`);
          return { status: 'success', updatedRange: result?.updates?.updatedRange };
        } catch (error: any) {
          throw new Error(`Google Sheets Execution Failed: ${error.message}. Please ensure the Service Account email has Edit access to the sheet.`);
        }
      }

      case 'outbound_webhook':
      case 'send_to_api':
      case 'ck_add_subscriber':
      case 'ck_add_tag':
      case 'ac_add_contact':
      case 'ac_add_tag':
      case 'pabbly_add_subscriber':
      case 'pabbly_add_tag':
      case 'aweber_add_subscriber':
      case 'aweber_add_tag': {
        const rawEndpoint = node.data?.apiEndpoint || node.data?.webhookUrl || node.data?.endpoint || '';
        const method = node.data?.apiMethod || node.data?.method || 'POST';
        
        if (!rawEndpoint) {
          throw new Error(`[CRM Engine] Missing API endpoint for ${actionType}.`);
        }

        const endpoint = this.parseDynamicVariables(rawEndpoint, context);

        // Build headers dynamically
        let rawHeaders = node.data?.headersList || node.data?.headers || [];
        const headers: Record<string, string> = {};
        
        // Handle case where headers might be a stringified JSON object
        if (typeof rawHeaders === 'string') {
          try {
            rawHeaders = JSON.parse(rawHeaders);
          } catch (e) {
            rawHeaders = [];
          }
        }

        if (Array.isArray(rawHeaders)) {
          for (const h of rawHeaders) {
            if (h.key && String(h.key).trim() !== '') {
              headers[h.key] = this.parseDynamicVariables(String(h.value || ''), context);
            }
          }
        } else if (typeof rawHeaders === 'object' && rawHeaders !== null) {
          for (const [k, v] of Object.entries(rawHeaders)) {
            headers[k] = this.parseDynamicVariables(String(v || ''), context);
          }
        }

        // Build body dynamically
        let rawBody = node.data?.bodyList || node.data?.reqBody || node.data?.body || [];
        const body: Record<string, any> = {};

        // Handle case where body might be a stringified JSON object
        if (typeof rawBody === 'string') {
          try {
            rawBody = JSON.parse(rawBody);
          } catch (e) {
            rawBody = [];
          }
        }

        if (Array.isArray(rawBody)) {
          for (const b of rawBody) {
            if (b.key && String(b.key).trim() !== '') {
              body[b.key] = this.parseDynamicVariables(String(b.value || ''), context);
            }
          }
        } else if (typeof rawBody === 'object' && rawBody !== null) {
          for (const [k, v] of Object.entries(rawBody)) {
            body[k] = this.parseDynamicVariables(String(v || ''), context);
          }
        }

        this.logger.log(`[CRM Engine] Dispatching external webhook to: ${endpoint} for action: ${actionType}`);

        try {
          const response = await lastValueFrom(
            this.httpService.request({
              method,
              url: endpoint,
              headers,
              data: body,
              timeout: 10000,
            })
          );
          
          this.logger.log(`[CRM Engine] Webhook ${actionType} successful with status: ${response.status}`);
          return { status: 'success', externalResponse: response.data };
        } catch (error: any) {
          const errorMsg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
          this.logger.error(`[CRM Engine] External webhook ${actionType} failed: ${errorMsg}`);
          throw new Error(`External API Call Failed: ${errorMsg}`);
        }
      }

      case 'add_crm_tag':
      case 'remove_crm_tag':
      case 'add_waba_tag':
      case 'remove_waba_tag': {
        const rawPhone = node.data?.whatsappPhone || node.data?.phone || '';
        const phone = this.parseDynamicVariables(rawPhone, context) || context.triggerData?.phone || '';
        
        const tagName = this.parseDynamicVariables(node.data?.selectedTag || node.data?.tag || '', context);

        if (!phone) {
          throw new Error(`[CRM Engine] Missing phone number for ${actionType}. Contact cannot be resolved.`);
        }
        if (!tagName) {
          throw new Error(`[CRM Engine] Missing tag name for ${actionType}.`);
        }

        const contact = await this.contactModel.findOne({ phone, adminId: context.projectId, isDeleted: false });
        if (!contact) {
          this.logger.warn(`[CRM Engine] Contact with phone ${this.maskPII(phone)} not found. Skipping ${actionType}.`);
          return { status: 'skipped', reason: 'contact_not_found' };
        }

        if (actionType === 'add_crm_tag') {
          await this.contactModel.updateOne({ _id: contact._id }, { $addToSet: { crmTags: tagName } });
        } else if (actionType === 'remove_crm_tag') {
          await this.contactModel.updateOne({ _id: contact._id }, { $pull: { crmTags: tagName } });
        } else if (actionType === 'add_waba_tag') {
          await this.contactModel.updateOne({ _id: contact._id }, { $addToSet: { wabaTags: tagName } });
        } else if (actionType === 'remove_waba_tag') {
          await this.contactModel.updateOne({ _id: contact._id }, { $pull: { wabaTags: tagName } });
        }

        this.logger.log(`[CRM Engine] Successfully executed ${actionType} ('${tagName}') for contact ${this.maskPII(phone)}.`);
        return { status: 'success', tag: tagName };
      }

      case 'add_to_sequence': {
        const sequenceFlowId = node.data?.selectedSequence || node.data?.sequenceFlowId || node.data?.sequenceId;
        if (!sequenceFlowId) {
          throw new Error(`[CRM Engine] Missing sequenceFlowId for add_to_sequence action.`);
        }

        const rawPhone = node.data?.whatsappPhone || node.data?.phone || '';
        const phone = this.parseDynamicVariables(rawPhone, context) || context.triggerData?.phone || '';

        const jobId = `${sequenceFlowId}_${phone}`;

        this.logger.log(`[CRM Engine] Enrolling into sequence (Flow ID: ${sequenceFlowId}) with jobId: ${jobId}`);

        await this.crmQueue.add('execute-flow', {
          flowId: sequenceFlowId,
          projectId: context.projectId,
          triggerData: context.triggerData
        }, { jobId });

        return { status: 'success', enrolledSequenceId: sequenceFlowId, jobId };
      }

      case 'remove_from_sequence': {
        const sequenceFlowId = node.data?.selectedSequence || node.data?.sequenceFlowId || node.data?.sequenceId;
        if (!sequenceFlowId) {
          throw new Error(`[CRM Engine] Missing sequenceFlowId for remove_from_sequence action.`);
        }

        const rawPhone = node.data?.whatsappPhone || node.data?.phone || '';
        const phone = this.parseDynamicVariables(rawPhone, context) || context.triggerData?.phone || '';

        const targetJobId = `${sequenceFlowId}_${phone}`;

        this.logger.log(`[CRM Engine] Attempting to remove from sequence. Target Job ID: ${targetJobId}`);

        const job = await this.crmQueue.getJob(targetJobId);
        if (job) {
          const state = await job.getState();
          if (state === 'delayed' || state === 'waiting' || state === 'paused') {
            await job.remove();
            this.logger.log(`[CRM Engine] Successfully removed sequence job ${targetJobId}`);
            return { status: 'success', removedJobId: targetJobId };
          } else {
            this.logger.log(`[CRM Engine] Job ${targetJobId} is in state '${state}' and cannot be removed.`);
            return { status: 'skipped', reason: `job_state_${state}` };
          }
        }

        return { status: 'not_found', targetJobId };
      }

      default:
        throw new NotImplementedException(`Unhandled node action type in CRM execution engine: ${actionType}`);
    }
  }

  /**
   * Main entry traversal loop for executing a CRM workflow.
   */
  async processCrmFlow(flow: any, eventData: any, startNodeId?: string, contextResponses?: any): Promise<void> {
    try {
      const graph = flow.graph;
      if (!graph) {
        this.logger.warn(`CRM active flow ${(flow as any)._id} does not contain a graph object.`);
        return;
      }

      let nextNodeId = startNodeId;

      if (!nextNodeId) {
        // 1. Locate the entry trigger node
        const triggerNode = this.getEntryNode(graph);
        if (!triggerNode) {
          this.logger.warn(`CRM active flow ${(flow as any)._id} is missing a trigger node.`);
          return;
        }

        // 2. Resolve immediate downstream target node
        nextNodeId = this.determineNextRoute(graph, triggerNode.id);
      }

      if (!nextNodeId) {
        this.logger.log(`CRM trigger node has no connected downstream targets.`);
        return;
      }

      const context: CrmExecutionContext = {
        projectId: String(flow.projectId || flow.whatsappProjectId),
        triggerData: eventData,
        responses: contextResponses || {},
        stepsCount: 0,
      };

      let currentNodeId: string | null = nextNodeId;
      while (currentNodeId) {
        // Prevent infinite loops (cyclic graph protection)
        context.stepsCount++;
        if (context.stepsCount > 50) {
          throw new Error(`[CRM Engine] Infinite loop execution aborted: exceeded maximum step threshold of 50.`);
        }

        const currentNode = this.getNodeById(graph, currentNodeId);
        if (!currentNode) {
          this.logger.warn(`CRM node ID ${currentNodeId} not found in graph.`);
          break;
        }

        this.logger.log(`[CRM Engine] Executing step ${context.stepsCount} (Node ID: ${currentNode.id}, Type: ${currentNode.type})`);

        let sourceHandleId: string | undefined = undefined;

        // --- NEW DELAY LOGIC ---
        if (currentNode.type === 'delay') {
          const actionType = currentNode.data?.actionType || currentNode.data?.type || currentNode.data?.delayType;
          let delayMs = 0;

          if (actionType === 'delay_for') {
            const delayValue = Number(currentNode.data?.delayValue || 0);
            const delayUnit = currentNode.data?.delayUnit || 'minutes';
            
            if (delayUnit === 'minutes') delayMs = delayValue * 60 * 1000;
            else if (delayUnit === 'hours') delayMs = delayValue * 60 * 60 * 1000;
            else if (delayUnit === 'days') delayMs = delayValue * 24 * 60 * 60 * 1000;
          } 
          else if (actionType === 'wait_until') {
            const rawTargetDate = currentNode.data?.targetDate || currentNode.data?.targetDateTime;
            if (rawTargetDate) {
               const parsedDateString = this.parseDynamicVariables(String(rawTargetDate), context);
               const targetDate = new Date(parsedDateString);
               if (!isNaN(targetDate.getTime())) {
                  delayMs = targetDate.getTime() - Date.now();
               }
            }
          }

          if (delayMs > 0) {
            this.logger.log(`[CRM Engine] Pausing execution at node ${currentNode.id} for ${delayMs}ms. Scheduling to BullMQ.`);
            
            // Dispatch downstream nodes to queue
            const targetEdges = graph.edges.filter((e: any) => e.source === currentNode.id);
            if (targetEdges.length === 0) {
              this.logger.log(`[CRM Engine] Delay node ${currentNode.id} has no downstream targets.`);
            } else {
              for (const edge of targetEdges) {
                 await this.crmQueue.add(
                   'execute-flow', 
                   { 
                     flowId: String(flow._id),
                     projectId: context.projectId,
                     triggerData: context.triggerData,
                     triggerNodeId: edge.target,
                     contextResponses: context.responses
                   },
                   { delay: delayMs }
                 );
              }
            }
            // Gracefully terminate current synchronous execution
            return;
          } else {
            this.logger.log(`[CRM Engine] Delay is <= 0ms. Continuing execution synchronously.`);
          }
        }

        // Execute action
        if (currentNode.type === 'action') {
          const nodeResult = await this.executeCrmNode(currentNode, context);
          context.responses[currentNode.id] = nodeResult;
          this.logger.log(`[CRM Engine] Saved response for node ${currentNode.id}`);
        }

        // --- NEW CONDITION LOGIC ---
        if (currentNode.type === 'condition' || currentNode.type === 'filter' || currentNode.type === 'logic') {
          const operator = currentNode.data?.operator || currentNode.data?.condition || '';
          const rawField = currentNode.data?.field || currentNode.data?.leftOperand || '';
          const rawValue = currentNode.data?.value || currentNode.data?.rightOperand || '';

          const parsedField = this.parseDynamicVariables(String(rawField), context);
          const parsedValue = this.parseDynamicVariables(String(rawValue), context);

          const isTrue = this.evaluateCondition(operator, parsedField, parsedValue);
          sourceHandleId = String(isTrue).toLowerCase();
          
          this.logger.log(`[CRM Engine] Evaluated condition node ${currentNode.id}: ${parsedField} ${operator} ${parsedValue} -> ${sourceHandleId}`);
          
          // Dynamic Edge Routing
          const targetEdges = graph.edges.filter((e: any) => e.source === currentNode.id);
          const activeEdges = targetEdges.filter((e: any) => {
            const handleId = String(e.sourceHandle || e.handle || '').toLowerCase();
            return handleId === sourceHandleId || handleId === String(isTrue);
          });

          if (activeEdges.length === 0) {
            this.logger.log(`[CRM Engine] Condition evaluated to ${sourceHandleId}, but no edges connected to this branch. Halting execution.`);
            break;
          }

          if (activeEdges.length > 1) {
             this.logger.log(`[CRM Engine] Multiple active branches detected for condition. Dispatching to BullMQ for parallel execution.`);
             for (const edge of activeEdges) {
               await this.crmQueue.add(
                 'execute-flow', 
                 { 
                   flowId: String(flow._id),
                   projectId: context.projectId,
                   triggerData: context.triggerData,
                   triggerNodeId: edge.target,
                   contextResponses: context.responses
                 }
               );
             }
             return;
          } else {
             currentNodeId = activeEdges[0].target;
             continue;
          }
        }

        // Determine next route for normal nodes
        const nextId = this.determineNextRoute(graph, currentNode.id, sourceHandleId);
        if (!nextId) {
          this.logger.log('[CRM Engine] Execution flow completed');
          break;
        }

        currentNodeId = nextId;
      }
    } catch (error: any) {
      this.logger.error(
        'Error executing CRM flow traversal:',
        error instanceof Error ? error.stack : error,
      );
      // Propagate error so that the queue knows it failed
      throw error;
    }
  }

  /**
   * Run a single action node execution (e.g. from UI testing)
   */
  async testSingleAction(nodeData: any, projectId: string, testVariables: any = {}): Promise<any> {
    const mockNode = { id: 'test_node', type: 'action', data: nodeData };
    const mockContext: CrmExecutionContext = {
      projectId,
      triggerData: testVariables,
      responses: {},
      stepsCount: 0
    };

    this.logger.log(`[CRM Engine] Testing single action: ${nodeData.actionType}`);
    
    // Execute the action natively
    return await this.executeCrmNode(mockNode, mockContext);
  }

  /**
   * Fetch execution logs for observability dashboard
   */
  async getExecutionLogs(projectId: string, limit: number = 50, page: number = 1, type?: string): Promise<any> {
    const skip = (page - 1) * limit;

    const pipeline: any[] = [
      { $match: { projectId } },
      // Convert string flowId to ObjectId for lookup
      {
        $addFields: {
          flowObjectId: { $toObjectId: "$flowId" }
        }
      },
      // Lookup AutomationFlow details
      {
        $lookup: {
          from: 'automationflows', // MongoDB collection name is usually lowercase plural
          localField: 'flowObjectId',
          foreignField: '_id',
          as: 'flowDetails'
        }
      },
      {
        $unwind: {
          path: "$flowDetails",
          preserveNullAndEmptyArrays: true
        }
      }
    ];

    // Optional Type Filtering
    if (type && type !== 'all') {
      pipeline.push({
        $match: { 'flowDetails.type': type }
      });
    }

    // Sort, Skip, Limit
    pipeline.push(
      { $sort: { executedAt: -1 } },
      {
        $facet: {
          metadata: [{ $count: "total" }],
          data: [{ $skip: skip }, { $limit: limit }]
        }
      }
    );

    const result = await this.flowExecutionLogModel.aggregate(pipeline);
    
    const logs = result[0]?.data || [];
    const total = result[0]?.metadata?.[0]?.total || 0;

    const enrichedLogs = logs.map(log => ({
      ...log,
      flowName: log.flowDetails?.name || 'Unknown Flow',
      flowType: log.flowDetails?.type || 'crm'
    }));

    return {
      data: enrichedLogs,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Helper to retrieve flow document by ID and process execution.
   */
  async startExecution(flowId: string, eventData: any, triggerNodeId?: string, contextResponses?: any): Promise<void> {
    const flow = await this.automationFlowModel.findById(flowId).exec();
    if (!flow) {
      this.logger.warn(`Flow ${flowId} not found for execution`);
      throw new Error(`Flow ${flowId} not found for execution`);
    }
    await this.processCrmFlow(flow, eventData, triggerNodeId, contextResponses);
  }
}
