import { Test, TestingModule } from '@nestjs/testing';
import { AutomationsProcessor } from './automations.processor';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { WhatsappService } from 'src/whatsapp/whatsapp.service';
import { WabaMessageType } from 'src/whatsapp-embed/waba-message/waba-message.schema';
import { AutomationExecution } from './schemas/automation-execution.schema';
import { AutomationFlow } from './schemas/automation-flow.schema';

describe('AutomationsProcessor', () => {
  let processor: AutomationsProcessor;
  let execModelMock: any;
  let flowModelMock: any;
  let whatsappServiceMock: any;

  // Helpers to create Mock documents with save()
  const mockSave = jest.fn().mockImplementation(function (this: any) {
    return Promise.resolve(this);
  });

  beforeEach(async () => {
    whatsappServiceMock = {
      getTemplatesForWaba: jest.fn().mockResolvedValue([
        { name: 'welcome_template', language: 'en_US' }
      ]),
      sendTemplateMessagev2: jest.fn().mockResolvedValue({ success: true }),
    };

    execModelMock = {
      find: jest.fn(),
      findById: jest.fn(),
      save: mockSave,
    };

    flowModelMock = {
      findById: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutomationsProcessor,
        {
          provide: getModelToken(AutomationExecution.name),
          useValue: execModelMock,
        },
        {
          provide: getModelToken(AutomationFlow.name),
          useValue: flowModelMock,
        },
        {
          provide: WhatsappService,
          useValue: whatsappServiceMock,
        },
      ],
    }).compile();

    processor = module.get<AutomationsProcessor>(AutomationsProcessor);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  describe('processExecution', () => {
    it('should successfully execute a simple Trigger -> WhatsApp action flow (backend node types)', async () => {
      const adminId = new Types.ObjectId();
      const projectId = new Types.ObjectId();
      const flowId = new Types.ObjectId();
      const executionId = new Types.ObjectId();

      const mockFlow = {
        _id: flowId,
        adminId,
        projectId,
        name: 'Test Flow Backend',
        graph: {
          nodes: [
            { id: '1', type: 'trigger:webinar', data: {} },
            {
              id: '2',
              type: 'action:whatsapp',
              data: {
                phonePath: 'user.phone',
                templateName: 'welcome_template',
                variables: [
                  { path: 'user.name' },
                  { value: 'Static Value' }
                ],
              },
            },
          ],
          edges: [
            { source: '1', target: '2' },
          ],
        },
      };

      const mockExecution: any = {
        _id: executionId,
        flowId,
        adminId,
        projectId,
        status: 'RUNNING',
        currentNodeId: '1',
        triggerData: {
          payload: {
            user: {
              phone: '919999999999',
              name: 'John Doe',
            },
          },
        },
        logs: [],
        save: mockSave,
      };

      execModelMock.findById.mockResolvedValue(mockExecution);
      flowModelMock.findById.mockResolvedValue(mockFlow);

      await (processor as any).processExecution(executionId);

      expect(mockExecution.status).toBe('COMPLETED');
      expect(whatsappServiceMock.sendTemplateMessagev2).toHaveBeenCalled();
    });

    it('should successfully execute a simple Trigger -> Action flow (frontend canvas node types)', async () => {
      const adminId = new Types.ObjectId();
      const projectId = new Types.ObjectId();
      const flowId = new Types.ObjectId();
      const executionId = new Types.ObjectId();

      const mockFlow = {
        _id: flowId,
        adminId,
        projectId,
        name: 'Test Flow Frontend',
        graph: {
          nodes: [
            { id: '1', type: 'trigger', data: { triggerType: 'webinar_registration' } },
            {
              id: '2',
              type: 'action',
              data: {
                actionType: 'send_whatsapp',
                phonePath: 'user.phone',
                templateName: 'welcome_template',
                variables: [
                  { path: 'user.name' },
                  { value: 'Static Value' }
                ],
              },
            },
          ],
          edges: [
            { source: '1', target: '2' },
          ],
        },
      };

      const mockExecution: any = {
        _id: executionId,
        flowId,
        adminId,
        projectId,
        status: 'RUNNING',
        currentNodeId: '1',
        triggerData: {
          payload: {
            user: {
              phone: '919999999999',
              name: 'John Doe',
            },
          },
        },
        logs: [],
        save: mockSave,
      };

      execModelMock.findById.mockResolvedValue(mockExecution);
      flowModelMock.findById.mockResolvedValue(mockFlow);

      await (processor as any).processExecution(executionId);

      expect(mockExecution.status).toBe('COMPLETED');
      expect(mockExecution.logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            level: 'info',
            message: expect.stringContaining('successfully sent'),
          }),
        ])
      );

      expect(whatsappServiceMock.sendTemplateMessagev2).toHaveBeenCalledWith({
        adminId: adminId.toString(),
        messageType: WabaMessageType.TEMPLATE,
        sendTemplateDto: {
          projectId: projectId.toString(),
          recipients: [
            {
              recipientPhoneNumber: '919999999999',
              bodyVariables: ['John Doe', 'Static Value'],
            },
          ],
          templateName: 'welcome_template',
          language: 'en_US',
          headerMediaAssetId: undefined,
        },
      });
    });

    it('should route through condition node (frontend canvas logic)', async () => {
      const adminId = new Types.ObjectId();
      const projectId = new Types.ObjectId();
      const flowId = new Types.ObjectId();
      const executionId = new Types.ObjectId();

      const mockFlow = {
        _id: flowId,
        adminId,
        projectId,
        name: 'Filter Test Flow',
        graph: {
          nodes: [
            { id: '1', type: 'trigger', data: {} },
            {
              id: '2',
              type: 'condition',
              data: {
                rules: [
                  { field: 'user.city', operator: 'equals', value: 'Delhi' },
                ],
              },
            },
            { id: '3', type: 'action', data: { actionType: 'send_whatsapp', phonePath: 'phone', templateName: 'delhi_temp' } },
            { id: '4', type: 'action', data: { actionType: 'send_whatsapp', phonePath: 'phone', templateName: 'other_temp' } },
          ],
          edges: [
            { source: '1', target: '2' },
            { source: '2', target: '3', sourceHandle: 'match' },
            { source: '2', target: '4', sourceHandle: 'no_match' },
          ],
        },
      };

      const mockExecution: any = {
        _id: executionId,
        flowId,
        adminId,
        projectId,
        status: 'RUNNING',
        currentNodeId: '1',
        triggerData: {
          payload: {
            phone: '918888888888',
            user: { city: 'Delhi' },
          },
        },
        logs: [],
        save: mockSave,
      };

      execModelMock.findById.mockResolvedValue(mockExecution);
      flowModelMock.findById.mockResolvedValue(mockFlow);

      await (processor as any).processExecution(executionId);

      expect(mockExecution.status).toBe('COMPLETED');
      expect(whatsappServiceMock.sendTemplateMessagev2).toHaveBeenCalledWith(
        expect.objectContaining({
          sendTemplateDto: expect.objectContaining({
            templateName: 'delhi_temp',
          }),
        })
      );
    });

    it('should halt and delay execution when delay node (frontend canvas logic) is encountered', async () => {
      const adminId = new Types.ObjectId();
      const projectId = new Types.ObjectId();
      const flowId = new Types.ObjectId();
      const executionId = new Types.ObjectId();

      const mockFlow = {
        _id: flowId,
        adminId,
        projectId,
        name: 'Delay Flow',
        graph: {
          nodes: [
            { id: '1', type: 'trigger', data: {} },
            {
              id: '2',
              type: 'delay',
              data: {
                amount: 30,
                unit: 'minutes',
              },
            },
            { id: '3', type: 'action', data: { actionType: 'send_whatsapp', phonePath: 'phone', templateName: 'welcome_template' } },
          ],
          edges: [
            { source: '1', target: '2' },
            { source: '2', target: '3' },
          ],
        },
      };

      const mockExecution: any = {
        _id: executionId,
        flowId,
        adminId,
        projectId,
        status: 'RUNNING',
        currentNodeId: '1',
        triggerData: {
          payload: { phone: '919999999999' },
        },
        logs: [],
        save: mockSave,
      };

      execModelMock.findById.mockResolvedValue(mockExecution);
      flowModelMock.findById.mockResolvedValue(mockFlow);

      await (processor as any).processExecution(executionId);

      expect(mockExecution.status).toBe('DELAYED');
      expect(mockExecution.executeAt).toBeDefined();

      const diffMs = mockExecution.executeAt.getTime() - Date.now();
      expect(diffMs).toBeGreaterThan(29 * 60 * 1000);
      expect(diffMs).toBeLessThan(31 * 60 * 1000);

      expect(whatsappServiceMock.sendTemplateMessagev2).not.toHaveBeenCalled();
    });

    it('should halt and delay execution when absolute date/time wait_until delay node is encountered', async () => {
      const adminId = new Types.ObjectId();
      const projectId = new Types.ObjectId();
      const flowId = new Types.ObjectId();
      const executionId = new Types.ObjectId();
      const targetTime = new Date(Date.now() + 2 * 3600000); // 2 hours from now

      const mockFlow = {
        _id: flowId,
        adminId,
        projectId,
        name: 'Absolute Delay Flow',
        graph: {
          nodes: [
            { id: '1', type: 'trigger', data: {} },
            {
              id: '2',
              type: 'delay',
              data: {
                delayType: 'wait_until',
                waitUntil: targetTime.toISOString(),
              },
            },
            { id: '3', type: 'action', data: { actionType: 'send_whatsapp', phonePath: 'phone', templateName: 'welcome_template' } },
          ],
          edges: [
            { source: '1', target: '2' },
            { source: '2', target: '3' },
          ],
        },
      };

      const mockExecution: any = {
        _id: executionId,
        flowId,
        adminId,
        projectId,
        status: 'RUNNING',
        currentNodeId: '1',
        triggerData: {
          payload: { phone: '919999999999' },
        },
        logs: [],
        save: mockSave,
      };

      execModelMock.findById.mockResolvedValue(mockExecution);
      flowModelMock.findById.mockResolvedValue(mockFlow);

      await (processor as any).processExecution(executionId);

      expect(mockExecution.status).toBe('DELAYED');
      expect(mockExecution.executeAt).toBeDefined();
      expect(mockExecution.executeAt.getTime()).toBe(targetTime.getTime());
      expect(whatsappServiceMock.sendTemplateMessagev2).not.toHaveBeenCalled();
    });
  });

  describe('resumeDelayedExecutions', () => {
    it('should find due delayed executions, set status running and process them', async () => {
      const mockExecutions = [
        {
          _id: new Types.ObjectId(),
          status: 'DELAYED',
          save: mockSave,
        },
      ];

      execModelMock.find.mockReturnValue({
        limit: jest.fn().mockResolvedValue(mockExecutions),
      });

      const processExecutionSpy = jest
        .spyOn(processor as any, 'processExecution')
        .mockResolvedValue(undefined);

      await processor.resumeDelayedExecutions();

      expect(mockExecutions[0].status).toBe('RUNNING');
      expect(processExecutionSpy).toHaveBeenCalledWith(mockExecutions[0]._id);
    });
  });

  describe('processPendingExecutions', () => {
    it('should find pending executions, set status running and process them', async () => {
      const mockExecutions = [
        {
          _id: new Types.ObjectId(),
          status: 'PENDING',
          save: mockSave,
        },
      ];

      execModelMock.find.mockReturnValue({
        limit: jest.fn().mockResolvedValue(mockExecutions),
      });

      const processExecutionSpy = jest
        .spyOn(processor as any, 'processExecution')
        .mockResolvedValue(undefined);

      await processor.processPendingExecutions();

      expect(mockExecutions[0].status).toBe('RUNNING');
      expect(processExecutionSpy).toHaveBeenCalledWith(mockExecutions[0]._id);
    });
  });
});
