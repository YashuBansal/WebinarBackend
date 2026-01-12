import { BadRequestException, Controller, Get, Param, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { ZoomMeetingService } from './zoom-meeting.service';
import { ZoomMeeting } from './zoom-meeting.schema';
import mongoose, { Types } from 'mongoose';
import { Id } from 'src/decorators/custom.decorator';

@Controller('zoom-meeting')
export class ZoomMeetingController {
  constructor(private readonly zoomMeetingService: ZoomMeetingService) {}

  @Get('projects/:projectId/meetings/:id')
  async getZoomMeeting(
    @Param('id') id: string,
    @Param('projectId') projectId: string,
    @Id() adminId: string,
  ): Promise<ZoomMeeting> {
    if (
      !mongoose.isValidObjectId(adminId) ||
      !mongoose.isValidObjectId(projectId)
    ) {
      throw new BadRequestException('Invalid adminId or projectId');
    }
    console.log(adminId, projectId, id);
    return await this.zoomMeetingService.getZoomMeeting(
      new Types.ObjectId(adminId),
      new Types.ObjectId(projectId),
      id,
    );
  }


  @Get('projects/:projectId/webinars/:id')
  async getZoomWebinar(
    @Param('id') id: string,
    @Param('projectId') projectId: string,
    @Id() adminId: string,
  ): Promise<ZoomMeeting> {
    if (
      !mongoose.isValidObjectId(adminId) ||
      !mongoose.isValidObjectId(projectId)
    ) {
      throw new BadRequestException('Invalid adminId or projectId');
    }
    console.log(adminId, projectId, id);
    return await this.zoomMeetingService.getZoomWebinar(
      new Types.ObjectId(adminId),
      new Types.ObjectId(projectId),
      id,
    );
  }

  @Post('projects/:projectId/meetings/:id/sync')
  @HttpCode(HttpStatus.OK)
  async syncMeeting(
    @Param('id') id: string,
    @Param('projectId') projectId: string,
    @Id() adminId: string,
  ) {
    if (
      !mongoose.isValidObjectId(adminId) ||
      !mongoose.isValidObjectId(projectId)
    ) {
      throw new BadRequestException('Invalid adminId or projectId');
    }

    try {
      await this.zoomMeetingService.syncZoomMeetingData(
        new Types.ObjectId(adminId),
        new Types.ObjectId(projectId),
        id,
      );
      return {
        statusCode: HttpStatus.OK,
        message: 'Meeting synced successfully',
      };
    } catch (error: any) {
      throw new BadRequestException(
        error.message || 'Failed to sync meeting data',
      );
    }
  }

  @Post('projects/:projectId/webinars/:id/sync')
  @HttpCode(HttpStatus.OK)
  async syncWebinar(
    @Param('id') id: string,
    @Param('projectId') projectId: string,
    @Id() adminId: string,
  ) {
    if (
      !mongoose.isValidObjectId(adminId) ||
      !mongoose.isValidObjectId(projectId)
    ) {
      throw new BadRequestException('Invalid adminId or projectId');
    }

    try {
      await this.zoomMeetingService.syncZoomWebinarData(
        new Types.ObjectId(adminId),
        new Types.ObjectId(projectId),
        id,
      );
      return {
        statusCode: HttpStatus.OK,
        message: 'Webinar synced successfully',
      };
    } catch (error: any) {
      throw new BadRequestException(
        error.message || 'Failed to sync webinar data',
      );
    }
  }
}
