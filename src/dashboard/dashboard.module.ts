import { MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from 'src/schemas/User.schema';
import { AuthSuperAdminMiddleware } from 'src/middlewares/authSuperAdmin.Middleware';
import { UsersModule } from 'src/users/users.module';
import {
  Subscription,
  SubscriptionSchema,
} from 'src/schemas/Subscription.schema';
import {
  BillingHistory,
  BillingHistorySchema,
} from 'src/schemas/BillingHistory.schema';
import { Attendee, AttendeeSchema } from 'src/schemas/Attendee.schema';
import { AssignmentModule } from 'src/assignment/assignment.module';
import { NotesModule } from 'src/notes/notes.module';
import { AuthAdminTokenMiddleware } from 'src/middlewares/authAdmin.Middleware';
import { AuthTokenMiddleware } from 'src/middlewares/authToken.Middleware';

@Module({
  imports: [
    UsersModule,
    AssignmentModule,
    NotesModule,
    MongooseModule.forFeature([
      {
        name: User.name,
        schema: UserSchema,
      },
      {
        name: Subscription.name,
        schema: SubscriptionSchema,
      },
      {
        name: BillingHistory.name,
        schema: BillingHistorySchema,
      },
      {
        name: Attendee.name,
        schema: AttendeeSchema,
      },
    ]),
  ],
  providers: [DashboardService],
  controllers: [DashboardController],
})
export class DashboardModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthSuperAdminMiddleware)
      .forRoutes(
        { path: 'dashboard/superAdmin', method: RequestMethod.ALL },
        { path: 'dashboard/plans', method: RequestMethod.ALL },
        { path: 'dashboard/users', method: RequestMethod.ALL },
        { path: 'dashboard/revenue', method: RequestMethod.ALL },
      );
    consumer
      .apply(AuthAdminTokenMiddleware)
      .forRoutes({ path: 'dashboard/admin', method: RequestMethod.ALL });
    consumer
      .apply(AuthTokenMiddleware)
      .forRoutes({ path: 'dashboard/employee', method: RequestMethod.ALL });
  }
}
