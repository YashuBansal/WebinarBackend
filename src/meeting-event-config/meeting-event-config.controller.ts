import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Patch,
  Query,
  ValidationPipe,
  UsePipes,
  NotAcceptableException,
} from '@nestjs/common';
import { MeetingEventConfigService } from './meeting-event-config.service';
import { Id } from 'src/decorators/custom.decorator';
import mongoose, { Types } from 'mongoose';
import {
  CreateMeetingEventConfigDto,
  UpdateMeetingEventConfigDto,
} from './dto/meeting-event-config.dto';

@Controller('meeting-event-config')
export class MeetingEventConfigController {
  constructor(
    private readonly meetingEventConfigService: MeetingEventConfigService,
  ) {}

  @Get(':meetingId')
  async getMeetingEventConfig(
    @Param('meetingId') meetingId: string,
    @Id() adminId: string,
    @Query('occurrenceId') occurrenceId?: string,
  ) {
    if (!mongoose.isValidObjectId(adminId)) {
      throw new NotAcceptableException('Invalid Admin ID');
    }

    const config = await this.meetingEventConfigService.getMeetingEventConfig(
      meetingId,
      occurrenceId,
    );

    return {
      statusCode: 200,
      message: 'Meeting event configuration fetched successfully',
      data: config,
    };
  }

  @Post()
  @UsePipes(new ValidationPipe({ transform: true }))
  async createMeetingEventConfig(
    @Body() createDto: CreateMeetingEventConfigDto,
    @Id() adminId: string,
  ) {
    if (!mongoose.isValidObjectId(adminId)) {
      throw new NotAcceptableException('Invalid Admin ID');
    }

    const config =
      await this.meetingEventConfigService.createMeetingEventConfig(
        createDto,
        new Types.ObjectId(`${adminId}`),
      );

    return {
      statusCode: 201,
      message: 'Meeting event configuration created successfully!',
      data: config,
    };
  }

  @Patch(':meetingId')
  @UsePipes(new ValidationPipe({ transform: true }))
  async updateMeetingEventConfig(
    @Param('meetingId') meetingId: string,
    @Body() updateDto: UpdateMeetingEventConfigDto,
    @Id() adminId: string,
  ) {
    if (!mongoose.isValidObjectId(adminId)) {
      throw new NotAcceptableException('Invalid Admin ID');
    }

    const config =
      await this.meetingEventConfigService.updateMeetingEventConfig(
        meetingId,
        updateDto,
      );

    return {
      statusCode: 200,
      message: 'Meeting event configuration updated successfully!',
      data: config,
    };
  }

  @Delete(':meetingId')
  async deleteMeetingEventConfig(
    @Param('meetingId') meetingId: string,
    @Id() adminId: string,
    @Query('occurrenceId') occurrenceId?: string,
  ) {
    if (!mongoose.isValidObjectId(adminId)) {
      throw new NotAcceptableException('Invalid Admin ID');
    }

    const config =
      await this.meetingEventConfigService.deleteMeetingEventConfig(
        meetingId,
        occurrenceId,
      );

    return {
      statusCode: 200,
      message: 'Meeting event configuration deleted successfully!',
      data: config,
    };
  }

  @Get()
  async getAllMeetingEventConfigs(@Id() adminId: string) {
    if (!mongoose.isValidObjectId(adminId)) {
      throw new NotAcceptableException('Invalid Admin ID');
    }

    const configs =
      await this.meetingEventConfigService.getAllMeetingEventConfigs(
        new Types.ObjectId(adminId),
      );

    return {
      statusCode: 200,
      message: 'Meeting event configurations fetched successfully',
      data: configs,
    };
  }
}
