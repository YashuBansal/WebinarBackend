import { forwardRef, MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';
import { ZoomController } from './zoom.controller';
import { ZoomService } from './zoom.service';
import { WebhookQueueService } from './webhook-queue.service';
import { ZoomProject, ZoomProjectSchema } from './schemas/zoom-project.schema';
import { ZoomMeetingEvent, ZoomMeetingEventSchema } from './schemas/zoom-meeting-event.schema';
import { UsersModule } from 'src/users/users.module';
import { ProjectsModule } from 'src/projects/projects.module';
import { AuthAdminTokenMiddleware } from 'src/middlewares/authAdmin.Middleware';
import { ZoomEventModule } from './zoom-event/zoom-event.module';
import { WebinarModule } from '../webinar/webinar.module';
import { MeetingEventConfigModule } from 'src/meeting-event-config/meeting-event-config.module';
import { ConfiguredTemplatesModule } from 'src/configured-templates/configured-templates.module';
import { WhatsappModule } from 'src/whatsapp/whatsapp.module';
import { AttendeesModule } from 'src/attendees/attendees.module';
import { WebsocketModule } from 'src/websocket/websocket.module';

@Module({
  imports: [
    HttpModule,
    forwardRef(() => UsersModule),
    forwardRef(() => ProjectsModule),
    forwardRef(() => WebinarModule),
    forwardRef(() => AttendeesModule),
    MongooseModule.forFeature([
      { name: ZoomProject.name, schema: ZoomProjectSchema },
    ]),
    forwardRef(() => ZoomEventModule), 
     MeetingEventConfigModule,
     ConfiguredTemplatesModule,
     WhatsappModule,
     WebsocketModule
  ],
  controllers: [ZoomController],
  providers: [ZoomService, WebhookQueueService],
  exports: [ZoomService],
})
export class ZoomModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthAdminTokenMiddleware)
      .exclude(
        { path: 'zoom/webhook-v2', method: RequestMethod.ALL },
        { path: 'zoom/webhook-v2/queue/health', method: RequestMethod.GET }
      )
      .forRoutes(ZoomController);
  }
}

