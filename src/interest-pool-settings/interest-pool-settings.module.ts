import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  InterestPoolSettings,
  InterestPoolSettingsSchema,
} from './interest-pool-settings.schema';
import { InterestPoolSettingsService } from './interest-pool-settings.service';
import { InterestPoolSettingsController } from './interest-pool-settings.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InterestPoolSettings.name, schema: InterestPoolSettingsSchema },
    ]),
  ],
  controllers: [InterestPoolSettingsController],
  providers: [InterestPoolSettingsService],
  exports: [InterestPoolSettingsService],
})
export class InterestPoolSettingsModule {}

