import {
  forwardRef,
  MiddlewareConsumer,
  Module,
  RequestMethod,
} from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Attendee, AttendeeSchema } from 'src/schemas/Attendee.schema';
import { AttendeesController } from './attendees.controller';
import { AttendeesService } from './attendees.service';
import { AuthAdminTokenMiddleware } from 'src/middlewares/authAdmin.Middleware';
import { AuthTokenMiddleware } from 'src/middlewares/authToken.Middleware';
import { GetAdminIdMiddleware } from 'src/middlewares/get-admin-id.middleware';
import { UsersModule } from 'src/users/users.module';
import { SubscriptionModule } from 'src/subscription/subscription.module';
import { ValidateBodyFilters } from 'src/middlewares/validate-body-filters.Middleware';
import { WebinarModule } from 'src/webinar/webinar.module';
import { NotificationModule } from 'src/notification/notification.module';
import { CompressionMiddleware } from '@nest-middlewares/compression';
import { AssignmentModule } from 'src/assignment/assignment.module';
import { AlarmModule } from 'src/alarm/alarm.module';
import { EnrollmentsModule } from 'src/enrollments/enrollments.module';
import { NotesModule } from 'src/notes/notes.module';
import { AttendeeAssociationModule } from 'src/attendee-association/attendee-association.module';
import { AttendeeLogModule } from 'src/attendee-log/attendee-log.module';
import { CustomLeadTypeModule } from 'src/custom-lead-type/custom-lead-type.module';
import { WebsocketModule } from 'src/websocket/websocket.module';
import { WebinarParticipantModule } from 'src/webinar-participant/webinar-participant.module';
import { TagsModule } from 'src/tags/tags.module';

@Module({
  imports: [
    forwardRef(() => UsersModule),
    forwardRef(() => SubscriptionModule),
    MongooseModule.forFeature([
      {
        name: Attendee.name,
        schema: AttendeeSchema,
      },
    ]),
    forwardRef(() => WebinarModule),
    forwardRef(() => AssignmentModule),
    NotificationModule,
    AlarmModule,
    forwardRef(() => EnrollmentsModule),
    NotesModule,
    AttendeeAssociationModule,
    AttendeeLogModule,
    CustomLeadTypeModule,
    WebsocketModule,
    WebinarParticipantModule,
    TagsModule,
  ],
  controllers: [AttendeesController],
  providers: [AttendeesService],
  exports: [AttendeesService],
})
export class AttendeesModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthAdminTokenMiddleware).forRoutes(
      { path: 'attendees', method: RequestMethod.POST },
      { path: 'attendees/invalid-tags', method: RequestMethod.GET },
      { path: 'attendees/swap', method: RequestMethod.PUT },
      { path: 'attendees/tag', method: RequestMethod.PUT },
      { path: 'attendees/webinar', method: RequestMethod.DELETE },
      {
        path: 'attendees/webinar-participants/:id',
        method: RequestMethod.GET,
      },
      { path: 'attendees/all', method: RequestMethod.DELETE },
      { path: 'attendees/tag-by-filters', method: RequestMethod.PUT },
      { path: 'attendees/tag-grouped', method: RequestMethod.PUT },
      { path: 'attendees/advance-filters', method: RequestMethod.POST },
    );

    consumer
      .apply(CompressionMiddleware)
      .forRoutes(
        { path: 'attendees/webinar', method: RequestMethod.GET },
        { path: 'attendees/grouped', method: RequestMethod.ALL },
      );

    consumer
      .apply(AuthTokenMiddleware, GetAdminIdMiddleware)
      .exclude(
        { path: 'attendees/webinar', method: RequestMethod.GET },
        { path: 'attendees/grouped', method: RequestMethod.ALL },
        { path: 'attendees/advance-filters', method: RequestMethod.POST },
      )
      .forRoutes(
        { path: 'attendees', method: RequestMethod.GET },
        { path: 'attendees/:email', method: RequestMethod.GET },
        { path: 'attendees/:id', method: RequestMethod.PATCH },
        { path: 'attendees/lead-type/:id', method: RequestMethod.PATCH },
      );

    consumer
      .apply(AuthAdminTokenMiddleware, ValidateBodyFilters)
      .forRoutes(
        { path: 'attendees/webinar', method: RequestMethod.GET },
        { path: 'attendees/grouped', method: RequestMethod.ALL },
      );
  }
}
