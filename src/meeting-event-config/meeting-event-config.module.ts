import {
  forwardRef,
  MiddlewareConsumer,
  Module,
  RequestMethod,
} from '@nestjs/common';
import { MeetingEventConfigService } from './meeting-event-config.service';
import { MeetingEventConfigController } from './meeting-event-config.controller';
import { AuthAdminTokenMiddleware } from 'src/middlewares/authAdmin.Middleware';
import { MongooseModule } from '@nestjs/mongoose';
import { MeetingEventConfiguration, MeetingEventConfigurationSchema } from './schemas/meeting-event-config.schema';
import { UsersModule } from 'src/users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MeetingEventConfiguration.name, schema: MeetingEventConfigurationSchema },
    ]),
    forwardRef(() => UsersModule),
  ],
  providers: [MeetingEventConfigService],
  exports: [MeetingEventConfigService],
  controllers: [MeetingEventConfigController],
})
export class MeetingEventConfigModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthAdminTokenMiddleware)
      .forRoutes(MeetingEventConfigController);
  }
}
