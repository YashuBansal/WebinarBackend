import { MiddlewareConsumer, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  InterestPoolSettings,
  InterestPoolSettingsSchema,
} from './interest-pool-settings.schema';
import { InterestPoolSettingsService } from './interest-pool-settings.service';
import { InterestPoolSettingsController } from './interest-pool-settings.controller';
import { AuthAdminTokenMiddleware } from 'src/middlewares/authAdmin.Middleware';
import { UsersModule } from 'src/users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InterestPoolSettings.name, schema: InterestPoolSettingsSchema },
    ]),
    UsersModule,
  ],
  controllers: [InterestPoolSettingsController],
  providers: [InterestPoolSettingsService],
  exports: [InterestPoolSettingsService],
})
export class InterestPoolSettingsModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthAdminTokenMiddleware).forRoutes(InterestPoolSettingsController);
  }
}

