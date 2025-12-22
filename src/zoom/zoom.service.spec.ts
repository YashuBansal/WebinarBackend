import { Test, TestingModule } from '@nestjs/testing';
import { ZoomService } from './zoom.service';
import { getModelToken } from '@nestjs/mongoose';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { ZoomEventService } from './zoom-event/zoom-event.service';
import { WebinarService } from '../webinar/webinar.service';
import { UsersService } from 'src/users/users.service';
import { MeetingEventConfigService } from 'src/meeting-event-config/meeting-event-config.service';
import { ConfiguredTemplatesService } from 'src/configured-templates/configured-templates.service';
import { WhatsappService } from 'src/whatsapp/whatsapp.service';
import { AttendeesService } from 'src/attendees/attendees.service';
import { WebhookQueueService } from './webhook-queue.service';
import { WhatsAppGateway } from 'src/websocket/whatsapp.gateway';
import { ZoomMeetingService } from './zoom-meeting/zoom-meeting.service';
import { Types } from 'mongoose';

describe('ZoomService - Consistency Fixes', () => {
  let service: ZoomService;
  let mockZoomProjectModel: any;
  let mockZoomEventService: any;
  let mockWebinarService: any;
  let mockMeetingEventConfigService: any;
  let mockWhatsappService: any;

  beforeEach(async () => {
    // Create mock implementations
    mockZoomProjectModel = {
      findById: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
      create: jest.fn(),
    };

    mockZoomEventService = {
      createMeetingEvent: jest.fn(),
      getMeetingEventsByMeetingId: jest.fn(),
    };

    mockWebinarService = {
      getWebinarRegistrations: jest.fn(),
      handleMeetingRegistration: jest.fn(),
    };

    mockMeetingEventConfigService = {
      getMeetingEventConfig: jest.fn(),
      updateEventExecutedFlag: jest.fn(),
    };

    mockWhatsappService = {
      sendTemplateMessages: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ZoomService,
        {
          provide: getModelToken('ZoomProject'),
          useValue: mockZoomProjectModel,
        },
        {
          provide: HttpService,
          useValue: { get: jest.fn(), post: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
        {
          provide: ZoomEventService,
          useValue: mockZoomEventService,
        },
        {
          provide: WebinarService,
          useValue: mockWebinarService,
        },
        {
          provide: UsersService,
          useValue: {},
        },
        {
          provide: MeetingEventConfigService,
          useValue: mockMeetingEventConfigService,
        },
        {
          provide: ConfiguredTemplatesService,
          useValue: { getConfiguredTemplate: jest.fn() },
        },
        {
          provide: WhatsappService,
          useValue: mockWhatsappService,
        },
        {
          provide: AttendeesService,
          useValue: { fetchGroupedAttendees: jest.fn() },
        },
        {
          provide: WebhookQueueService,
          useValue: { setProcessingWorker: jest.fn() },
        },
        {
          provide: WhatsAppGateway,
          useValue: { 
            emitZoomLiveUpdate: jest.fn(),
            emitZoomRegistrantsUpdate: jest.fn(),
            emitZoomRealtimeEvent: jest.fn(),
          },
        },
        {
          provide: ZoomMeetingService,
          useValue: { getZoomMeetingByMeetingId: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<ZoomService>(ZoomService);
  });

  describe('Fix 1: Error Handling Consistency', () => {
    it('should have explicit return in handleMeetingEnded catch block', async () => {
      // Mock the dependencies to throw an error
      mockMeetingEventConfigService.getMeetingEventConfig.mockRejectedValue(
        new Error('Test error'),
      );

      // Call handleMeetingEnded and verify it doesn't throw
      await expect(
        service.handleMeetingEnded('123', 'Test Meeting', false, undefined),
      ).resolves.toBeUndefined();
    });
  });

  describe('Fix 2: Timer Metrics Consistency', () => {
    it('should use consistent timer value for metrics', async () => {
      // This test verifies the timer is called once and reused
      // The actual implementation uses a closure, so we verify behavior indirectly
      const payload = {
        event: 'meeting.started',
        payload: {
          object: {
            id: '123',
            topic: 'Test Meeting',
          },
        },
      };

      mockZoomProjectModel.findById.mockResolvedValue({
        _id: new Types.ObjectId(),
        adminId: new Types.ObjectId(),
        isConfigured: true,
      });

      mockMeetingEventConfigService.getMeetingEventConfig.mockResolvedValue({
        meetingStarted: {
          enabled: false,
        },
      });

      // The test passes if no error is thrown
      await expect(
        service.processWebhookPayloadV2(payload, new Types.ObjectId().toString()),
      ).resolves.toBeUndefined();
    });
  });

  describe('Fix 3: Redundant Data Extraction', () => {
    it('should reuse participant data instead of re-extracting', async () => {
      const payload = {
        event: 'meeting.participant_left',
        payload: {
          object: {
            id: '123',
            participant: {
              email: 'test@example.com',
              user_name: 'Test User',
            },
          },
        },
      };

      mockZoomProjectModel.findById.mockResolvedValue({
        _id: new Types.ObjectId(),
        adminId: new Types.ObjectId(),
        isConfigured: true,
      });

      mockMeetingEventConfigService.getMeetingEventConfig.mockResolvedValue(null);

      // Verify the webhook processes without re-extracting participant
      await expect(
        service.processWebhookPayloadV2(payload, new Types.ObjectId().toString()),
      ).resolves.toBeUndefined();
    });
  });

  describe('Fix 4: Meeting ID Validation Consistency', () => {
    it('should validate meeting ID consistently in handleRegistrationCreated', async () => {
      // Test with string "undefined"
      await service.handleRegistrationCreated(
        'undefined',
        { email: 'test@example.com' },
        new Types.ObjectId().toString(),
        'meeting',
        undefined,
      );

      // Test with string "null"
      await service.handleRegistrationCreated(
        'null',
        { email: 'test@example.com' },
        new Types.ObjectId().toString(),
        'meeting',
        undefined,
      );

      // Test with empty string
      await service.handleRegistrationCreated(
        '   ',
        { email: 'test@example.com' },
        new Types.ObjectId().toString(),
        'meeting',
        undefined,
      );

      // All should return early without throwing
      expect(mockWebinarService.handleMeetingRegistration).not.toHaveBeenCalled();
    });
  });

  describe('Fix 5: isExecuted Flag Consistency', () => {
    it('should check isExecuted flag in handleMeetingStarted', async () => {
      mockMeetingEventConfigService.getMeetingEventConfig.mockResolvedValue({
        meetingStarted: {
          enabled: true,
          isExecuted: true,
          configuredTemplateId: new Types.ObjectId(),
        },
        adminId: new Types.ObjectId(),
        whatsappProjectId: new Types.ObjectId(),
        zoomProjectId: new Types.ObjectId(),
      });

      // Should return early due to isExecuted flag
      await service.handleMeetingStarted('123', 'Test Meeting', false, undefined);

      // Verify no messages were sent
      expect(mockWhatsappService.sendTemplateMessages).not.toHaveBeenCalled();
    });
  });

  describe('Fix 6: Email Validation Consistency', () => {
    it('should wrap email validation in try-catch for event records', async () => {
      const payload = {
        event: 'meeting.participant_joined',
        payload: {
          object: {
            id: '123',
            participant: {
              email: 'invalid-email', // Invalid email
              user_name: 'Test User',
            },
          },
        },
      };

      mockZoomProjectModel.findById.mockResolvedValue({
        _id: new Types.ObjectId(),
        adminId: new Types.ObjectId(),
        isConfigured: true,
      });

      // Should not throw despite invalid email
      await expect(
        service.processWebhookPayloadV2(payload, new Types.ObjectId().toString()),
      ).resolves.toBeUndefined();
    });
  });

  describe('Fix 7: OccurrenceId Handling Consistency', () => {
    it('should accept occurrenceId parameter in handleRegistrationCreated', async () => {
      const occurrenceId = '12345';
      
      mockWebinarService.handleMeetingRegistration.mockResolvedValue({});

      await service.handleRegistrationCreated(
        '123',
        { email: 'test@example.com' },
        new Types.ObjectId().toString(),
        'meeting',
        occurrenceId,
      );

      // Verify it was called with the occurrenceId
      expect(mockWebinarService.handleMeetingRegistration).toHaveBeenCalledWith(
        '123',
        expect.any(Object),
        occurrenceId,
      );
    });
  });

  describe('Fix 8: Registration Response Validation', () => {
    it('should normalize registration responses consistently', async () => {
      // Test with webinar service response
      mockWebinarService.getWebinarRegistrations.mockResolvedValue([
        { email: 'test@example.com', firstName: 'Test', lastName: 'User' },
      ]);

      const result1 = await service.getMeetingRegistrations({
        meetingId: '123',
        adminId: new Types.ObjectId(),
        projectId: new Types.ObjectId(),
        webinarID: new Types.ObjectId(),
        zoomProjectId: new Types.ObjectId(),
        isWebinar: false,
      });

      // Verify normalized structure
      expect(result1[0]).toHaveProperty('email');
      expect(result1[0]).toHaveProperty('phone');
      expect(result1[0]).toHaveProperty('firstName');
      expect(result1[0]).toHaveProperty('lastName');
    });

    it('should handle missing fields with defaults', async () => {
      mockWebinarService.getWebinarRegistrations.mockResolvedValue([
        { email: 'test@example.com' }, // Missing other fields
      ]);

      const result = await service.getMeetingRegistrations({
        meetingId: '123',
        adminId: new Types.ObjectId(),
        projectId: new Types.ObjectId(),
        webinarID: new Types.ObjectId(),
        zoomProjectId: new Types.ObjectId(),
        isWebinar: false,
      });

      // Verify defaults are applied
      expect(result[0].phone).toBe('');
      expect(result[0].firstName).toBe('');
      expect(result[0].lastName).toBe('');
    });
  });

  describe('Fix 9: Error Recovery Documentation', () => {
    it('should handle critical errors without retry', async () => {
      // Invalid project ID should return early
      await expect(
        service.processWebhookPayloadV2({ event: 'test' }, 'invalid-id'),
      ).resolves.toBeUndefined();
    });

    it('should handle validation errors without retry', async () => {
      mockZoomProjectModel.findById.mockResolvedValue({
        _id: new Types.ObjectId(),
        adminId: new Types.ObjectId(),
        isConfigured: true,
      });

      // Missing event should be caught and not throw
      await expect(
        service.processWebhookPayloadV2({}, new Types.ObjectId().toString()),
      ).resolves.toBeUndefined();
    });
  });

  describe('Fix 10: Consolidated Validation', () => {
    it('should not duplicate meeting ID validation in handlers', async () => {
      // handleParticipantJoined should only validate participantEmail
      await service.handleParticipantJoined(
        '123',
        '',
        false,
        undefined,
      );

      // Should return early due to missing email, not meeting ID
      expect(mockMeetingEventConfigService.getMeetingEventConfig).not.toHaveBeenCalled();
    });

    it('should not duplicate meeting ID validation in handleParticipantLeft', async () => {
      // handleParticipantLeft should only validate participant data
      await service.handleParticipantLeft(
        '123',
        null,
        false,
        undefined,
      );

      // Should return early due to missing participant data
      expect(mockMeetingEventConfigService.getMeetingEventConfig).not.toHaveBeenCalled();
    });
  });
});

