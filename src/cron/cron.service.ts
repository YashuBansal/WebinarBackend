import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AlarmService } from 'src/alarm/alarm.service';
import { SubscriptionService } from 'src/subscription/subscription.service';
import { UsersService } from 'src/users/users.service';
import { CampaignService } from 'src/whatsapp-embed/campaign/campaign.service';
import { ProgramService } from 'src/whatsapp-program/program.service';

@Injectable()
export class CronService implements OnModuleInit {
  private readonly logger = new Logger(CronService.name);

  constructor(
    private readonly userService: UsersService,
    private readonly alarmService: AlarmService,
    private readonly subscriptionService: SubscriptionService,
    private readonly campaignService: CampaignService,
    private readonly programService: ProgramService,
  ) {}

  async onModuleInit() {
    await this.everyDayJobs();
    await this.everyWeekJobs();
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleExpiredPlans(): Promise<void> {
    await this.everyDayJobs();
  }

  @Cron(CronExpression.EVERY_WEEK)
  async handleRevalidateUsedContactCounts(): Promise<void> {
    await this.everyWeekJobs();
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleScheduledTasks() {
    this.logger.log('Running scheduled tasks check...');

    try {
      // These tasks can run in parallel to save time
      await Promise.all([
        this.alarmService.processDueReminders(),
        this.alarmService.processDueAlarms(),
        this.campaignService.processScheduledCampaigns(),
        this.programService.processDueProgramSlots(),
      ]);
    } catch (error) {
      // This is a top-level catch for unexpected errors in the Promise.all
      this.logger.error(
        'An unexpected error occurred during scheduled task execution',
        error,
      );
    }
  }

  async everyWeekJobs() {
    this.logger.log('Revalidating used contact counts...');
    await this.subscriptionService.revalidateUsedContactCounts();
  }

  async everyDayJobs() {
    this.logger.log('Checking for expired plans...');
    await this.userService.deactivateExpiredPlans();

    this.logger.log('Checking for expired Tokens...');
    await this.userService.deleteexpiryTOkens();

    this.logger.log('Resetting daily contact count...');
    await this.userService.resetDailyContactCount();

    this.logger.log('Checking for upcoming expiry for plans...');
    await this.userService.alertAdminsForExpiry();

    this.logger.log('Cleaning up subscription addons...');
    await this.subscriptionService.updateSubscriptionAddons();
  }
}
