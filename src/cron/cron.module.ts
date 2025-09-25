import { Module } from '@nestjs/common';
import { CronService } from './cron.service';
import { ScheduleModule } from '@nestjs/schedule';
import { UsersModule } from 'src/users/users.module';
import { SubscriptionModule } from 'src/subscription/subscription.module';
import { AlarmModule } from 'src/alarm/alarm.module';
import { CampaignModule } from 'src/whatsapp-embed/campaign/campaign.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    UsersModule,
    SubscriptionModule,
    AlarmModule,
    CampaignModule,
  ],
  providers: [CronService],
})
export class CronModule {}
