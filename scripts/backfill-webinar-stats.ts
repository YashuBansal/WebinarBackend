import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Document, Model, Types } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';

import { AppModule } from '../src/app.module';
import {
  WebinarStatsBuckets,
  WebinarStatsService,
} from '../src/webinar/webinar-stats.service';
import { Webinar } from '../src/schemas/Webinar.schema';

type WebinarDocument = Webinar & Document;

const logger = new Logger('WebinarStatsBackfill');
const SCRIPT_VERSION = '1.0.0';

interface WebinarCountsSnapshot {
  totalRegistrations: number;
  totalParticipants: number;
  totalAttendees: number;
  totalUnAttended: number;
}

interface WebinarBackfillResult {
  webinarId: string;
  webinarName: string;
  adminId: string;
  status: 'success' | 'dry-run';
  before: WebinarCountsSnapshot;
  computed: WebinarCountsSnapshot;
  after: WebinarCountsSnapshot | null;
  hadMismatchBeforeBackfill: boolean;
  wasUpdated: boolean;
}

interface WebinarBackfillError {
  webinarId: string;
  webinarName: string;
  adminId: string;
  errorMessage: string;
  error: {
    message?: string;
    name?: string;
    stack?: string;
  };
  timestamp: string;
}

interface WebinarStatsBackfillReport {
  metadata: {
    timestamp: string;
    scriptVersion: string;
    dryRun: boolean;
    adminIdFilter: string | null;
    totalWebinars: number;
    totalProcessed: number;
    totalSucceeded: number;
    totalFailed: number;
    totalWithMismatchBeforeBackfill: number;
    totalUpdated: number;
    totalUnchanged: number;
  };
  results: WebinarBackfillResult[];
  errors: WebinarBackfillError[];
}

function parseArgs() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const adminIdArg = args.find((a) => a.startsWith('--adminId='));
  const adminId = adminIdArg ? adminIdArg.split('=')[1] : undefined;
  return { dryRun, adminId };
}

function toSnapshot(
  buckets: WebinarStatsBuckets,
  totalUnAttended?: number,
): WebinarCountsSnapshot {
  const unAttended =
    totalUnAttended ??
    Math.max(0, buckets.totalParticipants - buckets.totalAttendees);
  return {
    totalRegistrations: buckets.totalRegistrations,
    totalParticipants: buckets.totalParticipants,
    totalAttendees: buckets.totalAttendees,
    totalUnAttended: unAttended,
  };
}

function storedSnapshot(webinar: {
  totalRegistrations?: number;
  totalParticipants?: number;
  totalAttendees?: number;
  totalUnAttended?: number;
}): WebinarCountsSnapshot {
  return {
    totalRegistrations: webinar.totalRegistrations ?? 0,
    totalParticipants: webinar.totalParticipants ?? 0,
    totalAttendees: webinar.totalAttendees ?? 0,
    totalUnAttended: webinar.totalUnAttended ?? 0,
  };
}

function snapshotsEqual(
  a: WebinarCountsSnapshot,
  b: WebinarCountsSnapshot,
): boolean {
  return (
    a.totalRegistrations === b.totalRegistrations &&
    a.totalParticipants === b.totalParticipants &&
    a.totalAttendees === b.totalAttendees &&
    a.totalUnAttended === b.totalUnAttended
  );
}

async function backfillWebinarStats() {
  const { dryRun, adminId } = parseArgs();
  const appContext = await NestFactory.createApplicationContext(AppModule);

  try {
    const webinarModel = appContext.get<Model<WebinarDocument>>(
      getModelToken(Webinar.name),
    );
    const webinarStatsService = appContext.get(WebinarStatsService);

    const filter: Record<string, unknown> = {};
    if (adminId && Types.ObjectId.isValid(adminId)) {
      filter.adminId = new Types.ObjectId(adminId);
      logger.log(`Filtering webinars for adminId=${adminId}`);
    }

    const webinars = await webinarModel
      .find(filter)
      .select(
        '_id webinarName adminId totalRegistrations totalParticipants totalAttendees totalUnAttended',
      )
      .lean();

    logger.log(
      `Found ${webinars.length} webinar(s) to backfill${dryRun ? ' (dry-run)' : ''}.`,
    );

    const results: WebinarBackfillResult[] = [];
    const errors: WebinarBackfillError[] = [];
    let totalWithMismatchBeforeBackfill = 0;
    let totalUpdated = 0;
    let totalUnchanged = 0;

    for (let i = 0; i < webinars.length; i++) {
      const webinar = webinars[i];
      const webinarId = webinar._id?.toString() ?? '';
      const webinarName = webinar.webinarName ?? '';
      const webinarAdminId = webinar.adminId?.toString() ?? '';

      try {
        const before = storedSnapshot(webinar);
        const computedBuckets =
          await webinarStatsService.computeCountsForWebinar(
            webinar._id as Types.ObjectId,
          );
        const computed = toSnapshot(computedBuckets);
        const hadMismatchBeforeBackfill = !snapshotsEqual(before, computed);

        if (hadMismatchBeforeBackfill) {
          totalWithMismatchBeforeBackfill += 1;
        }

        if (dryRun) {
          results.push({
            webinarId,
            webinarName,
            adminId: webinarAdminId,
            status: 'dry-run',
            before,
            computed,
            after: null,
            hadMismatchBeforeBackfill,
            wasUpdated: hadMismatchBeforeBackfill,
          });
          if (hadMismatchBeforeBackfill) {
            totalUpdated += 1;
          } else {
            totalUnchanged += 1;
          }
        } else {
          const counts = await webinarStatsService.recomputeForWebinar(
            webinar._id as Types.ObjectId,
          );
          const after = toSnapshot(counts);
          const wasUpdated = !snapshotsEqual(before, after);

          results.push({
            webinarId,
            webinarName,
            adminId: webinarAdminId,
            status: 'success',
            before,
            computed,
            after,
            hadMismatchBeforeBackfill,
            wasUpdated,
          });

          if (wasUpdated) {
            totalUpdated += 1;
          } else {
            totalUnchanged += 1;
          }
        }

        if ((i + 1) % 50 === 0) {
          logger.log(`Progress: ${i + 1}/${webinars.length} webinars processed.`);
        }
      } catch (error: unknown) {
        const err = error as Error;
        errors.push({
          webinarId,
          webinarName,
          adminId: webinarAdminId,
          errorMessage: err?.message ?? String(error),
          error: {
            message: err?.message,
            name: err?.name,
            stack: err?.stack,
          },
          timestamp: new Date().toISOString(),
        });
        logger.error(
          `Failed to backfill webinar ${webinarId}`,
          err?.stack ?? String(error),
        );
      }
    }

    const totalSucceeded = results.length;
    const totalFailed = errors.length;

    logger.log('Creating backfill report file...');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportFileName = `webinar-stats-backfill-report-${timestamp}.json`;
    const reportFilePath = path.join(__dirname, reportFileName);

    const reportData: WebinarStatsBackfillReport = {
      metadata: {
        timestamp: new Date().toISOString(),
        scriptVersion: SCRIPT_VERSION,
        dryRun,
        adminIdFilter: adminId ?? null,
        totalWebinars: webinars.length,
        totalProcessed: totalSucceeded + totalFailed,
        totalSucceeded,
        totalFailed,
        totalWithMismatchBeforeBackfill,
        totalUpdated,
        totalUnchanged,
      },
      results,
      errors,
    };

    fs.writeFileSync(
      reportFilePath,
      JSON.stringify(reportData, null, 2),
      'utf8',
    );

    logger.log(`Backfill report created: ${reportFileName}`);

    logger.log('Backfill completed.');
    logger.log(
      `Summary: Webinars: ${webinars.length}, Succeeded: ${totalSucceeded}, Failed: ${totalFailed}, Mismatches (stored vs attendees): ${totalWithMismatchBeforeBackfill}, ${dryRun ? 'Would update' : 'Updated'}: ${totalUpdated}, Unchanged: ${totalUnchanged}, DryRun: ${dryRun}`,
    );

    if (errors.length > 0) {
      logger.warn(
        `Warning: ${errors.length} error(s) occurred. Check ${reportFileName} for details.`,
      );
      process.exitCode = 1;
    }
  } finally {
    await appContext.close();
  }
}

backfillWebinarStats()
  .then(() => {
    logger.log('Backfill script finished.');
    process.exit(process.exitCode ?? 0);
  })
  .catch((error) => {
    logger.error('Backfill script failed.', error?.stack ?? String(error));
    process.exit(1);
  });
