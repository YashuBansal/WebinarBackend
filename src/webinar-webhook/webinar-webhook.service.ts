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
  private readonly baseUrl: string;

  constructor(
    @InjectModel(WebinarWebhook.name)
    private webinarWebhookModel: Model<WebinarWebhookDocument>,
    private configService: ConfigService,
    @Inject(forwardRef(() => AssignmentService))
    private assignmentService: AssignmentService,
  ) {
    this.baseUrl = this.configService.get<string>('API_BASE_URL');
    if (!this.baseUrl) {
      throw new Error('API_BASE_URL is not set');
    }
  }

  async create(
    createWebinarWebhookDto: CreateWebinarWebhookDto,
    adminId: Types.ObjectId,
  ): Promise<WebinarWebhookDocument> {
    const { webinarId, webhookName } = createWebinarWebhookDto;

    // Validate webinarId
    if (!Types.ObjectId.isValid(webinarId)) {
      throw new BadRequestException('Invalid webinarId');
    }

    // Generate unique webhook token
    const webhookToken = randomBytes(32).toString('hex');

    // Generate webhook URL
    const webhookUrl = `${this.baseUrl}/api/v1/webinar-webhook/receive/${webhookToken}`;

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
      // Set isActive to true when fieldMapping is provided with values
      const hasMappings =
        updateWebinarWebhookDto.fieldMapping &&
        Object.keys(updateWebinarWebhookDto.fieldMapping).length > 0;

      if (hasMappings) {
        webhook.isActive = true;
      }
      webhook.fieldMapping = updateWebinarWebhookDto.fieldMapping as any;
    }

    if (updateWebinarWebhookDto.staticValues !== undefined) {
      // Validate that email is not in staticValues (email must always come from fieldMapping)
      if (
        updateWebinarWebhookDto.staticValues &&
        'email' in updateWebinarWebhookDto.staticValues
      ) {
        throw new BadRequestException(
          'Email cannot be set as a static value. Email must be mapped from webhook data.',
        );
      }

      // Set isActive to true when staticValues is provided with values
      const hasStaticValues =
        updateWebinarWebhookDto.staticValues &&
        Object.keys(updateWebinarWebhookDto.staticValues).length > 0;

      if (hasStaticValues) {
        webhook.isActive = true;
      }
      webhook.staticValues = updateWebinarWebhookDto.staticValues as any;
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

  async receiveWebhookData(
    token: string,
    data: any,
  ): Promise<{
    action: 'data_captured' | 'attendee_creation_triggered' | 'no_action';
    dataCaptured: boolean;
    attendeeCreationTriggered: boolean;
    webhookId: string;
  }> {
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

    let dataCaptured = false;
    let attendeeCreationTriggered = false;

    // Only update lastCapturedData if isResponseCaptured is false
    const isNewData = !webhook.isResponseCaptured;
    if (isNewData) {
      await this.webinarWebhookModel
        .findByIdAndUpdate(webhook._id, {
          $set: {
            lastCapturedData: data,
            lastCapturedAt: new Date(),
            isResponseCaptured: true,
          },
        })
        .exec()
        .catch((error) => {
          this.logger.error(
            `Failed to update webhook ${webhook._id}: ${error.message}`,
            error.stack,
          );
        });
      dataCaptured = true;
    }

    // Automatically create attendee if fieldMapping is configured and new data was captured
    if (
      !isNewData &&
      webhook.fieldMapping &&
      Object.keys(webhook.fieldMapping).length > 0 &&
      webhook.isResponseCaptured &&
      webhook.isActive
    ) {
      // Fire-and-forget: process attendee creation asynchronously without blocking webhook response
      this.logger.log(
        `Processing attendee creation for webhook: ${webhook._id}`,
      );
      attendeeCreationTriggered = true;
      this.processAttendeeCreation(webhook, data).catch((error) => {
        this.logger.error(
          `Failed to create attendee from webhook ${webhook._id}: ${error.message}`,
          error.stack,
        );
      });
    }

    // Determine action type
    let action: 'data_captured' | 'attendee_creation_triggered' | 'no_action';
    if (dataCaptured) {
      action = 'data_captured';
    } else if (attendeeCreationTriggered) {
      action = 'attendee_creation_triggered';
    } else {
      action = 'no_action';
    }

    return {
      action,
      dataCaptured,
      attendeeCreationTriggered,
      webhookId: webhook._id.toString(),
    };
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

      // Map webhook data to attendee DTO using fieldMapping and staticValues
      const attendeeDTO = this.mapWebhookDataToAttendee(
        bodyData,
        webhook.fieldMapping as any,
        webhook.staticValues as any,
      );

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
   * Map webhook data to PreWebinarPostAttendeeDTO using fieldMapping and staticValues
   * Priority: Email always from fieldMapping, other fields: staticValues > fieldMapping > default
   * @param webhookData - The captured webhook data
   * @param fieldMapping - The field mapping configuration (paths to webhook data)
   * @param staticValues - Static values to use (overrides fieldMapping for non-email fields)
   * @returns PreWebinarPostAttendeeDTO or null if email is missing
   */
  private mapWebhookDataToAttendee(
    webhookData: any,
    fieldMapping: {
      email?: string;
      firstName?: string;
      lastName?: string;
      phone?: string;
      location?: string;
      gender?: string;
      profession?: string;
      tags?: string;
      source?: string;
    },
    staticValues?: {
      firstName?: string;
      lastName?: string;
      phone?: string;
      location?: string;
      gender?: string;
      profession?: string;
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
      profession: null,
      tags: [],
      timeInSession: 0,
      isAttended: false,
      webinar: null as any, // Will be set by caller
      adminId: null as any, // Will be set by caller
      source: 'webhook', // Default source
    };

    // Extract email (required field) - ALWAYS from fieldMapping, never from staticValues
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

    // Extract optional fields - priority: staticValues > fieldMapping > default
    // firstName
    if (staticValues?.firstName) {
      attendee.firstName = staticValues.firstName.trim() || null;
    } else if (fieldMapping.firstName) {
      const firstName = this.getNestedValue(
        webhookData,
        fieldMapping.firstName,
      );
      if (firstName && typeof firstName === 'string') {
        attendee.firstName = firstName.trim() || null;
      }
    }

    // lastName
    if (staticValues?.lastName) {
      attendee.lastName = staticValues.lastName.trim() || null;
    } else if (fieldMapping.lastName) {
      const lastName = this.getNestedValue(webhookData, fieldMapping.lastName);
      if (lastName && typeof lastName === 'string') {
        attendee.lastName = lastName.trim() || null;
      }
    }

    // phone
    if (staticValues?.phone) {
      attendee.phone =
        typeof staticValues.phone === 'string'
          ? staticValues.phone.trim()
          : String(staticValues.phone);
    } else if (fieldMapping.phone) {
      const phone = this.getNestedValue(webhookData, fieldMapping.phone);
      if (phone) {
        attendee.phone =
          typeof phone === 'string' ? phone.trim() : String(phone);
      }
    }

    // location
    if (staticValues?.location) {
      attendee.location = staticValues.location.trim() || null;
    } else if (fieldMapping.location) {
      const location = this.getNestedValue(webhookData, fieldMapping.location);
      if (location && typeof location === 'string') {
        attendee.location = location.trim() || null;
      }
    }

    // gender
    if (staticValues?.gender) {
      const lowerGender = staticValues.gender.trim().toLowerCase();
      if (['male', 'female', 'others'].includes(lowerGender)) {
        attendee.gender = lowerGender;
      }
    } else if (fieldMapping.gender) {
      const gender = this.getNestedValue(webhookData, fieldMapping.gender);
      if (gender && typeof gender === 'string') {
        const lowerGender = gender.trim().toLowerCase();
        if (['male', 'female', 'others'].includes(lowerGender)) {
          attendee.gender = lowerGender;
        }
      }
    }

    // profession
    if (staticValues?.profession) {
      attendee.profession = staticValues.profession.trim() || null;
    } else if (fieldMapping.profession) {
      const profession = this.getNestedValue(
        webhookData,
        fieldMapping.profession,
      );
      if (profession && typeof profession === 'string') {
        attendee.profession = profession.trim() || null;
      }
    }

    // tags
    if (staticValues?.tags) {
      if (Array.isArray(staticValues.tags)) {
        attendee.tags = staticValues.tags
          .filter((tag) => tag && typeof tag === 'string')
          .map((tag) => tag.trim().toLowerCase())
          .filter((tag) => tag);
      } else if (typeof staticValues.tags === 'string') {
        attendee.tags = staticValues.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter((tag) => tag)
          .map((tag) => tag.toLowerCase());
      }
    } else if (fieldMapping.tags) {
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

    // source - priority: staticValues > fieldMapping > default 'webhook'
    if (staticValues?.source) {
      attendee.source = staticValues.source.trim();
    } else if (fieldMapping.source) {
      const source = this.getNestedValue(webhookData, fieldMapping.source);
      if (source && typeof source === 'string' && source.trim()) {
        attendee.source = source.trim();
      }
    }

    return attendee;
  }
}
