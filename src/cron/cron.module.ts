import { Module } from '@nestjs/common';
import { CronService } from './cron.service';
import { ScheduleModule } from '@nestjs/schedule';
import { UsersModule } from 'src/users/users.module';
import { SubscriptionModule } from 'src/subscription/subscription.module';
import { AlarmModule } from 'src/alarm/alarm.module';
import { CampaignModule } from 'src/whatsapp-embed/campaign/campaign.module';
import { ProgramModule } from 'src/whatsapp-program/program.module';
import { AddonPurchaseModule } from 'src/addon-purchase/addon-purchase.module';
import { ProfileModule } from 'src/profile/profile.module';
import { ProjectsModule } from 'src/projects/projects.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    UsersModule,
    SubscriptionModule,
    AddonPurchaseModule,
    AlarmModule,
    CampaignModule,
    ProgramModule,
    ProfileModule,
    ProjectsModule,
  ],
  providers: [CronService],
})
export class CronModule {}
