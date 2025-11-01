import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Inject,
  Logger,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import {
  WebinarWebhook,
  WebinarWebhookDocument,
} from './schemas/webinar-webhook.schema';
import {
  CreateWebinarWebhookDto,
  UpdateWebinarWebhookDto,
} from './dto/create-webinar-webhook.dto';
import { AssignmentService } from 'src/assignment/assignment.service';
import { PreWebinarPostAttendeeDTO } from 'src/attendees/dto/attendees.dto';

@Injectable()
export class WebinarWebhookService {
  private readonly logger = new Logger(WebinarWebhookService.name);

  constructor(
    @InjectModel(WebinarWebhook.name)
    private webinarWebhookModel: Model<WebinarWebhookDocument>,
    private configService: ConfigService,
    @Inject(forwardRef(() => AssignmentService))
    private assignmentService: AssignmentService,
  ) {}

  async create(
    createWebinarWebhookDto: CreateWebinarWebhookDto,
    adminId: Types.ObjectId,
  ): Promise<WebinarWebhookDocument> {
    const { webinarId, webhookName } =
      createWebinarWebhookDto;

    // Validate webinarId
    if (!Types.ObjectId.isValid(webinarId)) {
      throw new BadRequestException('Invalid webinarId');
    }

    // Generate unique webhook token
    const webhookToken = randomBytes(32).toString('hex');
    
    // Generate webhook URL
    const baseUrl = this.configService.get<string>('BASE_URL') || 
                   this.configService.get<string>('API_BASE_URL') ||
                   'http://localhost:3000';
    const webhookUrl = `${baseUrl}/api/v1/webinar-webhook/receive/${webhookToken}`;

    const webinarWebhook = new this.webinarWebhookModel({
      webinarId: new Types.ObjectId(webinarId),
      adminId,
      webhookName,
      webhookUrl,
      webhookToken,
      // isActive defaults to true in schema
    });

    return await webinarWebhook.save();
  }

  async findAll(
    webinarId: string,
    adminId: Types.ObjectId,
  ): Promise<WebinarWebhookDocument[]> {
    const query: any = { adminId };

    if (webinarId) {
      if (!Types.ObjectId.isValid(webinarId)) {
        throw new BadRequestException('Invalid webinarId');
      }
      query.webinarId = new Types.ObjectId(webinarId);
    }

    return await this.webinarWebhookModel
      .find(query)
      .sort({ createdAt: -1 })
      .exec();
  }

  async findOne(
    id: string,
    adminId: Types.ObjectId,
  ): Promise<WebinarWebhookDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid webhook ID');
    }

    const webhook = await this.webinarWebhookModel
      .findOne({
        _id: new Types.ObjectId(id),
        adminId,
      })
      .exec();

    if (!webhook) {
      throw new NotFoundException('Webhook not found');
    }

    return webhook;
  }

  async update(
    id: string,
    updateWebinarWebhookDto: UpdateWebinarWebhookDto,
    adminId: Types.ObjectId,
  ): Promise<WebinarWebhookDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid webhook ID');
    }

    const webhook = await this.webinarWebhookModel
      .findOne({
        _id: new Types.ObjectId(id),
        adminId,
      })
      .exec();

    if (!webhook) {
      throw new NotFoundException('Webhook not found');
    }

    // Update only provided fields
    if (updateWebinarWebhookDto.webhookName !== undefined) {
      webhook.webhookName = updateWebinarWebhookDto.webhookName;
    }
    if (updateWebinarWebhookDto.webhookUrl !== undefined) {
      webhook.webhookUrl = updateWebinarWebhookDto.webhookUrl;
    }
    if (updateWebinarWebhookDto.isActive !== undefined) {
      webhook.isActive = updateWebinarWebhookDto.isActive;
    }
    if (updateWebinarWebhookDto.isResponseCaptured !== undefined) {
      webhook.isResponseCaptured = updateWebinarWebhookDto.isResponseCaptured;
    }
    if (updateWebinarWebhookDto.fieldMapping !== undefined) {
      // Validate that email is provided when fieldMapping is set
      if (!updateWebinarWebhookDto.fieldMapping.email || !updateWebinarWebhookDto.fieldMapping.email.trim()) {
        throw new BadRequestException('Email field mapping is required when fieldMapping is provided');
      }
      webhook.fieldMapping = updateWebinarWebhookDto.fieldMapping;
      // Set isActive to true when fieldMapping is provided
      webhook.isActive = true;
    }

    return await webhook.save();
  }

  async remove(id: string, adminId: Types.ObjectId): Promise<void> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid webhook ID');
    }

    const result = await this.webinarWebhookModel
      .findOneAndDelete({
        _id: new Types.ObjectId(id),
        adminId,
      })
      .exec();

    if (!result) {
      throw new NotFoundException('Webhook not found');
    }
  }

  async receiveWebhookData(token: string, data: any): Promise<WebinarWebhookDocument> {
    // Find webhook by token
    const webhook = await this.webinarWebhookModel
      .findOne({
        webhookToken: token,
        isActive: true,
      })
      .exec();

    if (!webhook) {
      throw new NotFoundException('Webhook not found or inactive');
    }

    // Only update lastCapturedData if isResponseCaptured is false
    const isNewData = !webhook.isResponseCaptured;
    if (isNewData) {
      webhook.lastCapturedData = data;
      webhook.lastCapturedAt = new Date();
      webhook.isResponseCaptured = true;
    }

    const savedWebhook = await webhook.save();
    console.log(isNewData, webhook.fieldMapping, Object.keys(webhook.fieldMapping).length);

    // Automatically create attendee if fieldMapping is configured and new data was captured
    if (!isNewData && webhook.fieldMapping && Object.keys(webhook.fieldMapping).length > 0 && webhook.isResponseCaptured && webhook.isActive) {
      // Fire-and-forget: process attendee creation asynchronously without blocking webhook response
      console.log('Processing attendee creation for webhook:', webhook._id);
      this.processAttendeeCreation(webhook, data).catch((error) => {
        this.logger.error(
          `Failed to create attendee from webhook ${webhook._id}: ${error.message}`,
          error.stack,
        );
      });
    }

    return savedWebhook;
  }

  /**
   * Process attendee creation from webhook data
   * @param webhook - The webhook document
   * @param webhookData - The captured webhook data
   */
  private async processAttendeeCreation(
    webhook: WebinarWebhookDocument,
    webhookData: any,
  ): Promise<void> {
    try {
      // Extract body from webhook data (we store {body, headers, timestamp})
      const bodyData = webhookData.body || webhookData;

      // Map webhook data to attendee DTO using fieldMapping
      const attendeeDTO = this.mapWebhookDataToAttendee(bodyData, webhook.fieldMapping);

      if (!attendeeDTO) {
        this.logger.warn(
          `Could not map webhook data to attendee for webhook ${webhook._id}. Email may be missing.`,
        );
        return;
      }

      // Set required fields from webhook
      attendeeDTO.webinar = webhook.webinarId;
      attendeeDTO.adminId = webhook.adminId;

      // Call assignment service to create attendee and handle assignments
      const result = await this.assignmentService.addPreWebinarAssignments(
        webhook.adminId.toString(),
        webhook.webinarId.toString(),
        attendeeDTO,
      );

      this.logger.log(
        `Successfully created attendee from webhook ${webhook._id} for email: ${attendeeDTO.email}`,
      );
    } catch (error) {
      // Log error but don't throw - webhook data is already saved
      this.logger.error(
        `Error creating attendee from webhook ${webhook._id}: ${error.message}`,
        error.stack,
      );
      // Re-throw to be caught by caller's catch block
      throw error;
    }
  }

  async findByToken(token: string): Promise<WebinarWebhookDocument | null> {
    return await this.webinarWebhookModel
      .findOne({
        webhookToken: token,
      })
      .exec();
  }

  /**
   * Helper function to extract nested values from object using dot notation path
   * @param obj - The object to extract value from
   * @param path - Dot notation path (e.g., "body.email", "body.user.name")
   * @returns The value at the path or undefined if not found
   */
  private getNestedValue(obj: any, path: string): any {
    if (!path || !obj) return undefined;

    const keys = path.split('.');
    let current = obj;

    for (const key of keys) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[key];
    }

    return current;
  }

  /**
   * Map webhook data to PreWebinarPostAttendeeDTO using fieldMapping
   * @param webhookData - The captured webhook data
   * @param fieldMapping - The field mapping configuration
   * @returns PreWebinarPostAttendeeDTO or null if email is missing
   */
  private mapWebhookDataToAttendee(
    webhookData: any,
    fieldMapping: {
      email: string; // Required
      firstName?: string;
      lastName?: string;
      phone?: string;
      location?: string;
      gender?: string;
      tags?: string;
      source?: string;
    },
  ): PreWebinarPostAttendeeDTO | null {
    if (!fieldMapping || !webhookData) {
      return null;
    }

    const attendee: PreWebinarPostAttendeeDTO = {
      email: '',
      firstName: null,
      lastName: null,
      phone: null,
      location: null,
      gender: null,
      tags: [],
      timeInSession: 0,
      isAttended: false,
      webinar: null as any, // Will be set by caller
      adminId: null as any, // Will be set by caller
      source: 'webhook', // Default source
    };

    // Extract email (required field)
    const email = this.getNestedValue(webhookData, fieldMapping.email);
    if (email && typeof email === 'string' && email.trim()) {
      attendee.email = email.trim().toLowerCase();
    } else {
      // Email is required, return null if missing
      this.logger.warn(
        `Email not found at path: ${fieldMapping.email}. Attendee creation skipped.`,
      );
      return null;
    }

    // Extract optional fields
    if (fieldMapping.firstName) {
      const firstName = this.getNestedValue(webhookData, fieldMapping.firstName);
      if (firstName && typeof firstName === 'string') {
        attendee.firstName = firstName.trim() || null;
      }
    }

    if (fieldMapping.lastName) {
      const lastName = this.getNestedValue(webhookData, fieldMapping.lastName);
      if (lastName && typeof lastName === 'string') {
        attendee.lastName = lastName.trim() || null;
      }
    }

    if (fieldMapping.phone) {
      const phone = this.getNestedValue(webhookData, fieldMapping.phone);
      if (phone) {
        attendee.phone = typeof phone === 'string' ? phone.trim() : String(phone);
      }
    }

    if (fieldMapping.location) {
      const location = this.getNestedValue(webhookData, fieldMapping.location);
      if (location && typeof location === 'string') {
        attendee.location = location.trim() || null;
      }
    }

    if (fieldMapping.gender) {
      const gender = this.getNestedValue(webhookData, fieldMapping.gender);
      if (gender && typeof gender === 'string') {
        const lowerGender = gender.trim().toLowerCase();
        if (['male', 'female', 'others'].includes(lowerGender)) {
          attendee.gender = lowerGender;
        }
      }
    }

    if (fieldMapping.tags) {
      const tags = this.getNestedValue(webhookData, fieldMapping.tags);
      if (tags) {
        if (Array.isArray(tags)) {
          // Already an array
          attendee.tags = tags
            .filter((tag) => tag && typeof tag === 'string')
            .map((tag) => tag.trim().toLowerCase())
            .filter((tag) => tag);
        } else if (typeof tags === 'string') {
          // Comma-separated string - convert to array
          attendee.tags = tags
            .split(',')
            .map((tag) => tag.trim())
            .filter((tag) => tag)
            .map((tag) => tag.toLowerCase());
        }
      }
    }

    // Extract source field if mapped, otherwise use default 'webhook'
    if (fieldMapping.source) {
      const source = this.getNestedValue(webhookData, fieldMapping.source);
      if (source && typeof source === 'string' && source.trim()) {
        attendee.source = source.trim();
      }
    }

    return attendee;
  }
}

