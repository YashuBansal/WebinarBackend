import { Module } from '@nestjs/common';
import { CronService } from './cron.service';
import { ScheduleModule } from '@nestjs/schedule';
import { UsersModule } from 'src/users/users.module';
import { SubscriptionAddonModule } from 'src/subscription-addon/subscription-addon.module';
import { SubscriptionModule } from 'src/subscription/subscription.module';
import { AlarmModule } from 'src/alarm/alarm.module';

@Module({
  imports: [ScheduleModule.forRoot(), UsersModule, SubscriptionModule, AlarmModule],
  providers: [CronService],
})
export class CronModule {}
