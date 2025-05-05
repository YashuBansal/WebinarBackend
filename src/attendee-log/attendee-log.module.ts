import { Module } from '@nestjs/common';
import { AttendeeLogController } from './attendee-log.controller';
import { AttendeeLogService } from './attendee-log.service';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AttendeeLog,
  AttendeeLogSchema,
} from 'src/schemas/attendee-logs.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: AttendeeLog.name,
        schema: AttendeeLogSchema,
      },
    ]),
  ],
  controllers: [AttendeeLogController],
  providers: [AttendeeLogService],
  exports: [AttendeeLogService],
})
export class AttendeeLogModule {}
