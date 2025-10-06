import { forwardRef, MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';
import { ZoomController } from './zoom.controller';
import { ZoomService } from './zoom.service';
import { ZoomProject, ZoomProjectSchema } from './schemas/zoom-project.schema';
import { ZoomMeetingEvent, ZoomMeetingEventSchema } from './schemas/zoom-meeting-event.schema';
import { UsersModule } from 'src/users/users.module';
import { ProjectsModule } from 'src/projects/projects.module';
import { AuthAdminTokenMiddleware } from 'src/middlewares/authAdmin.Middleware';

@Module({
  imports: [
    HttpModule,
    forwardRef(() => UsersModule),
    forwardRef(() => ProjectsModule),
    MongooseModule.forFeature([
      { name: ZoomProject.name, schema: ZoomProjectSchema },
      { name: ZoomMeetingEvent.name, schema: ZoomMeetingEventSchema },
    ]),
  ],
  controllers: [ZoomController],
  providers: [ZoomService],
  exports: [ZoomService],
})
export class ZoomModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthAdminTokenMiddleware)
      .exclude({ path: 'zoom/webhook', method: RequestMethod.ALL })
      .forRoutes(ZoomController);
  }
}

