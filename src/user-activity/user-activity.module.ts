import { MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  UserActivity,
  UserActivitySchema,
} from 'src/schemas/UserActivity.schema';
import { UserActivityController } from './user-activity.controller';
import { UserActivityService } from './user-activity.service';
import { JwtModule } from '@nestjs/jwt';
import { NotificationModule } from 'src/notification/notification.module';
import { ConfigService } from '@nestjs/config';
import { AuthAdminTokenMiddleware } from 'src/middlewares/authAdmin.Middleware';
import { WebsocketGateway } from 'src/websocket/websocket.gateway';
import { AuthTokenMiddleware } from 'src/middlewares/authToken.Middleware';
import { UsersModule } from 'src/users/users.module';
import { WebsocketModule } from 'src/websocket/websocket.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserActivity.name, schema: UserActivitySchema },
    ]),
    JwtModule.register({
      global: true,
    }),
    NotificationModule,
    UsersModule,
    WebsocketModule
  ],
  controllers: [UserActivityController],
  providers: [UserActivityService, ConfigService],
  exports: [UserActivityService],
})
export class UserActivityModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthTokenMiddleware)
      .exclude({
        path: 'user-activities/employee',
        method: RequestMethod.GET,
      })
      .forRoutes(UserActivityController);

    consumer.apply(AuthAdminTokenMiddleware).forRoutes({
      path: 'user-activities/employee',
      method: RequestMethod.GET,
    });
  }
}
