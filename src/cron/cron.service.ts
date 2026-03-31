import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AlarmService } from 'src/alarm/alarm.service';
import { SubscriptionService } from 'src/subscription/subscription.service';
import { UsersService } from 'src/users/users.service';
import { CampaignService } from 'src/whatsapp-embed/campaign/campaign.service';
import { ProgramService } from 'src/whatsapp-program/program.service';
import { AddonPurchaseService } from 'src/addon-purchase/addon-purchase.service';
import { ProfileService } from 'src/profile/profile.service';
import { ProjectsService } from 'src/projects/projects.service';

@Injectable()
export class CronService implements OnModuleInit {
  private readonly logger = new Logger(CronService.name);

  constructor(
    private readonly userService: UsersService,
    private readonly alarmService: AlarmService,
    private readonly subscriptionService: SubscriptionService,
    private readonly campaignService: CampaignService,
    private readonly programService: ProgramService,
    private readonly addonPurchaseService: AddonPurchaseService,
    private readonly profileService: ProfileService,
    private readonly projectsService: ProjectsService,
  ) {}

  async onModuleInit() {
    await this.everyDayJobs();
    await this.everyWeekJobs();
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleExpiredPlans(): Promise<void> {
    await this.everyDayJobs();
  }

  @Cron(CronExpression.EVERY_QUARTER)
  async handleRevalidateUsedContactCounts(): Promise<void> {
    await this.everyWeekJobs();
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleAddonExpirySync(): Promise<void> {
    this.logger.log('Running addon expiry sync...');
    await this.subscriptionService.expireAndRecomputeAffectedSubscriptionAddons();
  }

  @Cron(CronExpression.EVERY_10_MINUTES) // Every 10 minutes
  async handleAutoAssignments() {
    this.logger.log('Running auto-assignments evaluation...');
    try {
      await this.programService.evaluateAllAutoAssignments();
    } catch (error) {
      this.logger.error('Error during auto-assignments evaluation', error);
    }
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

  @Cron(CronExpression.EVERY_HOUR)
  async handleHourlyProfileSync(): Promise<void> {
    const startedAt = Date.now();
    this.logger.log('Running hourly profile sync...');

    // Sync profile cache for projects that have WhatsApp business account credentials.
    const projects = await this.projectsService.findAll();
    const eligibleProjects = projects.filter(
      (p) =>
        p?.permanentAccessToken &&
        p?.phoneNumberId &&
        // "project is not deleted" requirement
        (p as any)?.isDeleted !== true,
    );

    // Select admins who are active, so only their projects get synced.
    const adminIds = Array.from(
      new Set(
        eligibleProjects
          .map((p) =>
            ((p as any)?.adminId?._id ?? (p as any)?.adminId)
              ? String((p as any)?.adminId?._id ?? (p as any)?.adminId)
              : null,
          )
          .filter((id): id is string => Boolean(id)),
      ),
    );

    const activeAdmins = await this.userService.findActiveUsersByIds(adminIds);
    const activeAdminIdSet = new Set(activeAdmins.map((a) => String(a._id)));

    let skippedMissingIds = 0;
    let skippedInactiveAdmin = 0;
    let attempted = 0;
    let succeeded = 0;
    let failed = 0;

    this.logger.log(
      `Hourly profile sync summary (pre-run) ${JSON.stringify({
        totalProjects: projects.length,
        eligibleProjects: eligibleProjects.length,
        uniqueAdminsInEligibleProjects: adminIds.length,
        activeAdmins: activeAdmins.length,
      })}`,
    );

    for (const project of eligibleProjects) {
      // `Project` type class me `_id` present nahi hai, but Mongoose runtime me hota hai.
      // Also `adminId` populated hoga (User object), so uska `_id` nikaalna padega.
      const adminId =
        (project as any)?.adminId?._id ?? (project as any)?.adminId;
      const projectId = (project as any)?._id;

      try {
        if (!adminId || !projectId) {
          skippedMissingIds += 1;
          this.logger.warn(
            `Hourly profile sync skipped: missing ids ${JSON.stringify({
              adminId: adminId ? String(adminId) : null,
              projectId: projectId ? String(projectId) : null,
            })}`,
          );
          continue;
        }
        if (!activeAdminIdSet.has(String(adminId))) {
          skippedInactiveAdmin += 1;
          continue;
        }

        attempted += 1;
        await this.profileService.syncBusinessProfile(
          adminId as any,
          projectId as any,
        );
        succeeded += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(
          `Failed to sync business profile ${JSON.stringify({
            adminId: String((adminId as any)?._id ?? adminId),
            projectId: String(projectId),
            message: (error as any)?.message ?? error,
          })}`,
        );
      }
    }

    this.logger.log(
      `Hourly profile sync finished ${JSON.stringify({
        attempted,
        succeeded,
        failed,
        skippedMissingIds,
        skippedInactiveAdmin,
        elapsedMs: Date.now() - startedAt,
      })}`,
    );
  }

  async everyWeekJobs() {
    this.logger.log('Revalidating used contact counts...');
    await this.subscriptionService.updateSubscriptionContactCount();
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

    this.logger.log('Reconciling paid addon purchases...');
    await this.addonPurchaseService.reconcilePaidPurchases(100);

    this.logger.log('Backfilling missing addon billing histories...');
    await this.addonPurchaseService.reconcileMissingAddonBilling(200);
  }
}
