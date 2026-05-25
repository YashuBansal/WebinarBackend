import { forwardRef, MiddlewareConsumer, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { IntegrationSettings, IntegrationSettingsSchema } from './integrations.schema';
import {
  InterestPoolSettings,
  InterestPoolSettingsSchema,
} from '../interest-pool-settings/interest-pool-settings.schema';
import { Attendee, AttendeeSchema } from 'src/schemas/Attendee.schema';
import { IntegrationsService } from './integrations.service';
import { IntegrationsController } from './integrations.controller';
import { AuthAdminTokenMiddleware } from 'src/middlewares/authAdmin.Middleware';
import { UsersModule } from 'src/users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: IntegrationSettings.name, schema: IntegrationSettingsSchema },
      { name: InterestPoolSettings.name, schema: InterestPoolSettingsSchema },
      { name: Attendee.name, schema: AttendeeSchema },
    ]),
    forwardRef(() => UsersModule),
  ],
  controllers: [IntegrationsController],
  providers: [IntegrationsService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthAdminTokenMiddleware)
      .forRoutes(IntegrationsController);
  }
}
