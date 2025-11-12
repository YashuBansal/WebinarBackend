import {
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model, Types } from 'mongoose';
import {
  MeetingEventConfiguration,
  MeetingEventConfigurationDocument,
} from './schemas/meeting-event-config.schema';
import {
  CreateMeetingEventConfigDto,
  UpdateMeetingEventConfigDto,
} from './dto/meeting-event-config.dto';

@Injectable()
export class MeetingEventConfigService {
  private readonly logger = new Logger(MeetingEventConfigService.name);

  constructor(
    @InjectModel(MeetingEventConfiguration.name)
    private readonly meetingEventConfigModel: Model<MeetingEventConfigurationDocument>,
  ) {}

  async getMeetingEventConfig(
    meetingId: string,
  ): Promise<MeetingEventConfiguration | null> {
    try {
      this.logger.log(
        `Fetching meeting event configuration for meeting ${meetingId}`,
      );

      const config = await this.meetingEventConfigModel
        .findOne({ meetingId })
        .exec();

      return config;
    } catch (error) {
      this.logger.error(
        `Failed to fetch meeting event configuration: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(
        'A server error occurred while fetching meeting event configuration.',
      );
    }
  }

  async createMeetingEventConfig(
    createDto: CreateMeetingEventConfigDto,
    adminId: Types.ObjectId,
  ) {
    try {
      this.logger.log(
        `Creating meeting event configuration for meeting ${createDto.meetingId}`,
      );

      // Check if configuration already exists for this meeting
      const existingConfig = await this.meetingEventConfigModel
        .findOne({ meetingId: createDto.meetingId, adminId })
        .exec();

      if (existingConfig) {
        throw new BadRequestException(
          'Meeting event configuration already exists for this meeting',
        );
      }

      const config = new this.meetingEventConfigModel({
        ...createDto,
        adminId,
        whatsappProjectId: new Types.ObjectId(createDto.whatsappProjectId),
        zoomProjectId: new Types.ObjectId(createDto.zoomProjectId),
      });

      const savedConfig = await config.save();

      // Populate the saved config
      const populatedConfig = await this.meetingEventConfigModel
        .findById(savedConfig._id)
        .populate('whatsappProjectId', 'projectName')
        .exec();

      this.logger.log(
        `Meeting event configuration created successfully: ${savedConfig._id}`,
      );
      return populatedConfig;
    } catch (error) {
      this.logger.error(
        `Failed to create meeting event configuration: ${error.message}`,
        error.stack,
      );
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'A server error occurred while creating meeting event configuration.',
      );
    }
  }

  async updateMeetingEventConfig(
    meetingId: string,
    updateDto: UpdateMeetingEventConfigDto,
  ) {
    try {
      this.logger.log(
        `Updating meeting event configuration for meeting ${meetingId}`,
        updateDto,
      );

      const updateData: any = { ...updateDto };

      // Convert string IDs to ObjectIds if provided
      if (mongoose.isValidObjectId(updateDto.whatsappProjectId)) {
        updateData.whatsappProjectId = new Types.ObjectId(
          updateDto.whatsappProjectId,
        );
      }

      if (mongoose.isValidObjectId(updateDto.zoomProjectId)) {
        updateData.zoomProjectId = new Types.ObjectId(updateDto.zoomProjectId);
      }

      if (mongoose.isValidObjectId(updateDto.webinarId)) {
        updateData.webinarId = new Types.ObjectId(updateDto.webinarId);
      } else {
        updateData.webinarId = null;
      }

      const updatedConfig = await this.meetingEventConfigModel
        .findOneAndUpdate(
          { meetingId },
          { ...updateData },
          { new: true },
        )
        .populate('whatsappProjectId', 'projectName')
        .exec();

      if (!updatedConfig) {
        throw new NotFoundException('Meeting event configuration not found');
      }

      this.logger.log(
        `Meeting event configuration updated successfully: ${updatedConfig._id}`,
      );
      return updatedConfig;
    } catch (error) {
      this.logger.error(
        `Failed to update meeting event configuration: ${error.message}`,
        error.stack,
      );
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'A server error occurred while updating meeting event configuration.',
      );
    }
  }

  async deleteMeetingEventConfig(meetingId: string) {
    try {
      this.logger.log(
        `Deleting meeting event configuration for meeting ${meetingId}`,
      );

      const deletedConfig = await this.meetingEventConfigModel
        .findOneAndDelete({ meetingId })
        .exec();

      if (!deletedConfig) {
        throw new NotFoundException('Meeting event configuration not found');
      }

      this.logger.log(
        `Meeting event configuration deleted successfully: ${deletedConfig._id}`,
      );
      return deletedConfig;
    } catch (error) {
      this.logger.error(
        `Failed to delete meeting event configuration: ${error.message}`,
        error.stack,
      );
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'A server error occurred while deleting meeting event configuration.',
      );
    }
  }

  async getAllMeetingEventConfigs(adminId: Types.ObjectId) {
    try {
      this.logger.log(
        `Fetching all meeting event configurations for admin ${adminId}`,
      );

      const configs = await this.meetingEventConfigModel
        .find()
        .populate({
          path: 'whatsappProjectId',
          match: { adminId },
          select: 'projectName',
        })
        .populate('configuredTemplateId', 'configuredTemplateName templateName')
        .exec();

      // Filter out configs where the project doesn't belong to the admin
      const filteredConfigs = configs.filter(
        (config) => config.whatsappProjectId,
      );

      return filteredConfigs;
    } catch (error) {
      this.logger.error(
        `Failed to fetch meeting event configurations: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(
        'A server error occurred while fetching meeting event configurations.',
      );
    }
  }

  /**
   * If a meeting event configuration exists for the given meetingId and adminId,
   * update its webinarId to the provided value. If webinarId is invalid/empty, it will be cleared.
   * Returns the updated document, or null if no config exists. Never throws NotFound.
   */
  async setWebinarIdIfConfigExists(
    adminId: Types.ObjectId,
    meetingId: string,
    webinarId?: string,
  ): Promise<MeetingEventConfiguration | null> {
    try {
      this.logger.log(`Attempting to set webinarId on meeting config. meetingId=${meetingId} webinarId=${webinarId}`);

      const existing = await this.meetingEventConfigModel.findOne({ meetingId, adminId }).exec();
      if (!existing) {
        this.logger.log(`No meeting event config found for meetingId=${meetingId}. Skipping webinarId update.`);
        return null;
      }

      if (mongoose.isValidObjectId(webinarId)) {
        existing.webinarId = new Types.ObjectId(webinarId);
      } else {
        // clear webinarId
        existing.webinarId = null as any;
      }
      const updated = await existing.save();

      this.logger.log(`Meeting event config webinarId updated for meetingId=${meetingId}`);
      return updated;
    } catch (error) {
      this.logger.error(
        `Failed to set webinarId on meeting event configuration: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(
        'A server error occurred while updating meeting event configuration webinarId.',
      );
    }
  }

  /**
   * Update the isExecuted flag for a specific event type in a meeting event configuration
   * Sets the flag to true permanently - cannot be reset
   */
  async updateEventExecutedFlag(
    meetingId: string,
    eventType: 'meetingStarted' | 'meetingEndedAttendees' | 'meetingEndedNonAttendees',
  ): Promise<MeetingEventConfiguration | null> {
    try {
      this.logger.log(
        `Updating isExecuted flag for meeting ${meetingId}, eventType: ${eventType}`,
      );

      const updateField = `${eventType}.isExecuted`;
      const updatedConfig = await this.meetingEventConfigModel
        .findOneAndUpdate(
          { meetingId },
          { $set: { [updateField]: true } },
          { new: true },
        )
        .exec();

      if (!updatedConfig) {
        this.logger.warn(
          `Meeting event configuration not found for meeting: ${meetingId}`,
        );
        return null;
      }

      this.logger.log(
        `Successfully updated isExecuted flag for meeting: ${meetingId}, eventType: ${eventType}`,
      );
      return updatedConfig;
    } catch (error) {
      this.logger.error(
        `Failed to update isExecuted flag: ${error.message}`,
        error.stack,
      );
      // Don't throw to avoid breaking webhook processing
      return null;
    }
  }
}
