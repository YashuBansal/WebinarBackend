import { Controller, Get, Param, Query } from '@nestjs/common';
import { AttendeeLogService } from './attendee-log.service';
import { AdminId } from 'src/decorators/custom.decorator';
import { Types } from 'mongoose';
import { FetchAttendeeLogDTO } from './dto/attendee-log.dto';

@Controller('attendee-log')
export class AttendeeLogController {
  constructor(private readonly attendeeLogService: AttendeeLogService) {}

  @Get('/:email')
  async getActiveInactiveAssignments(
    @Param('email') email: string,
    @AdminId() adminId: string,
    @Query() query: FetchAttendeeLogDTO,
  ): Promise<any> {
    const result = await this.attendeeLogService.fetchAttendeeLogsByAttendee(
      email,
      new Types.ObjectId(`${adminId}`),
      query,
    );
    return result;
  }
}
