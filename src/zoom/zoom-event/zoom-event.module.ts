import { forwardRef, MiddlewareConsumer, Module } from '@nestjs/common';
import { ZoomEventController } from './zoom-event.controller';
import { ZoomEventService } from './zoom-event.service';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ZoomMeetingEvent,
  ZoomMeetingEventSchema,
} from '../schemas/zoom-meeting-event.schema';
import { ZoomModule } from '../zoom.module';
import { AuthAdminTokenMiddleware } from 'src/middlewares/authAdmin.Middleware';
import { UsersModule } from 'src/users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ZoomMeetingEvent.name, schema: ZoomMeetingEventSchema },
    ]),
    forwardRef(() => ZoomModule),
    forwardRef(() => UsersModule),
  ],
  controllers: [ZoomEventController],
  providers: [ZoomEventService],
  exports: [ZoomEventService],
})
export class ZoomEventModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthAdminTokenMiddleware).forRoutes(ZoomEventController);
  }
}
