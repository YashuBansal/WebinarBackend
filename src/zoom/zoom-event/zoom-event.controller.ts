import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { ZoomEventService } from './zoom-event.service';
import { Id } from 'src/decorators/custom.decorator';
import mongoose, { Types } from 'mongoose';

@Controller('zoom-event')
export class ZoomEventController {
  constructor(private readonly zoomEventService: ZoomEventService) {}

  @Get(':meetingId')
  async getMeetingStatus(
    @Id() adminId: string,
    @Param('meetingId') meetingId: string,
    @Query('isWebinar') isWebinar: string,
    @Query('zoomProjectId') zoomProjectId: string,
    @Query('accountId') accountId?: string,
  ) {
    if (!mongoose.isValidObjectId(adminId) || !mongoose.isValidObjectId(zoomProjectId)) {
      throw new BadRequestException('Invalid adminId or zoomProjectId');
    }
    console.log('isWebinar', isWebinar, typeof isWebinar);
    return this.zoomEventService.getMeetingStatus({
      adminId : new Types.ObjectId(`${adminId}`),
      zoomProjectId: new Types.ObjectId(`${zoomProjectId}`),
      meetingId,
      accountId,
      isWebinar: isWebinar === 'true',
    });
  }
}
