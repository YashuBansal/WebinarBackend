import { Controller, Get, Param } from '@nestjs/common';
import { AttendeeLogService } from './attendee-log.service';

@Controller('attendee-log')
export class AttendeeLogController {
  constructor(private readonly attendeeLogService: AttendeeLogService) {}

  @Get('/:email')
  async getActiveInactiveAssignments(
    @Param('email') email: string,
  ): Promise<any> {
    const result =
      await this.attendeeLogService.fetchAttendeeLogsByAttendee(email);
    return result;
  }
}
