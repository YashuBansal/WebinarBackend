import { Module } from '@nestjs/common';
import { ZoomEventController } from './zoom-event.controller';
import { ZoomEventService } from './zoom-event.service';
import { MongooseModule } from '@nestjs/mongoose';
import { ZoomMeetingEvent, ZoomMeetingEventSchema } from '../schemas/zoom-meeting-event.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: ZoomMeetingEvent.name, schema: ZoomMeetingEventSchema }])],
  controllers: [ZoomEventController],
  providers: [ZoomEventService],
  exports: [ZoomEventService],
})
export class ZoomEventModule {}
