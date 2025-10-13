import { Controller, Get, Param, Query } from '@nestjs/common';
import { ZoomEventService } from './zoom-event.service';

@Controller('zoom-event')
export class ZoomEventController {
  constructor(private readonly zoomEventService: ZoomEventService) {}

  @Get(':meetingId')
  async getMeetingStatus(
    @Param('meetingId') meetingId: string,
    @Query('accountId') accountId?: string,
  ) {
    return this.zoomEventService.getMeetingStatus(meetingId, accountId);
  }
}
