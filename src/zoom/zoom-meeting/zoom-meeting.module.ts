import { forwardRef, MiddlewareConsumer, Module } from '@nestjs/common';
import { ZoomMeetingService } from './zoom-meeting.service';
import { ZoomMeetingController } from './zoom-meeting.controller';
import { ZoomMeeting, ZoomMeetingSchema } from './zoom-meeting.schema';
import { MongooseModule } from '@nestjs/mongoose';
import { ZoomModule } from '../zoom.module';
import { AuthAdminTokenMiddleware } from 'src/middlewares/authAdmin.Middleware';
import { UsersModule } from 'src/users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ZoomMeeting.name, schema: ZoomMeetingSchema },
    ]),
    forwardRef(() => ZoomModule),
    forwardRef(() => UsersModule),
  ],
  providers: [ZoomMeetingService],
  controllers: [ZoomMeetingController],
  exports: [ZoomMeetingService],
})
export class ZoomMeetingModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthAdminTokenMiddleware).forRoutes(ZoomMeetingController);
  }
}
