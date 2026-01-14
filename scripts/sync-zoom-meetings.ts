import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Document, Model, Types } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';

import { AppModule } from '../src/app.module';
import { ZoomProject, ZoomProjectDocument } from '../src/zoom/schemas/zoom-project.schema';
import { ZoomService } from '../src/zoom/zoom.service';
import { ZoomMeetingService } from '../src/zoom/zoom-meeting/zoom-meeting.service';

type ZoomProjectDocumentType = ZoomProject & Document;

interface SyncError {
  projectId: string;
  projectName: string;
  type: 'meeting' | 'webinar' | 'project';
  id?: string;
  errorMessage: string;
  error: any;
  timestamp: string;
}

interface SyncReport {
  metadata: {
    timestamp: string;
    scriptVersion: string;
    totalProjects: number;
    totalProcessed: number;
    totalMeetingsSynced: number;
    totalWebinarsSynced: number;
    totalErrors: number;
  };
  errors: SyncError[];
}

const logger = new Logger('SyncZoomMeetings');
const SCRIPT_VERSION = '1.0.0';

async function syncZoomMeetings() {
  const appContext = await NestFactory.createApplicationContext(AppModule);

  try {
    const zoomProjectModel = appContext.get<Model<ZoomProjectDocumentType>>(
      getModelToken(ZoomProject.name),
    );
    const zoomService = appContext.get<ZoomService>(ZoomService);
    const zoomMeetingService = appContext.get<ZoomMeetingService>(ZoomMeetingService);

    logger.log('Starting Zoom meetings and webinars sync...');

    // Fetch all configured Zoom projects
    const projects = await zoomProjectModel.find({
      isConfigured: true,
      accessToken: { $exists: true, $ne: null },
    });

    logger.log(`Found ${projects.length} configured Zoom projects`);

    if (projects.length === 0) {
      logger.log('No configured projects found. Nothing to sync.');
      return;
    }

    const errors: SyncError[] = [];
    let totalProcessed = 0;
    let totalMeetingsSynced = 0;
    let totalWebinarsSynced = 0;

    // Process each project
    for (let i = 0; i < projects.length; i++) {
      const project = projects[i];
      const projectId = project._id instanceof Types.ObjectId 
        ? project._id.toString() 
        : String(project._id);
      const adminId = project.adminId instanceof Types.ObjectId
        ? project.adminId
        : new Types.ObjectId(project.adminId);

      logger.log(
        `Processing project ${i + 1}/${projects.length}: ${project.projectName} (${projectId})`,
      );

      try {
        // Sync Meetings
        try {
          logger.log(`  Fetching upcoming meetings for project ${project.projectName}...`);
          const meetingsResult = await zoomService.getProjectMeetings(
            adminId,
            project._id,
            'upcoming',
            { pageSize: 300 },
          );

          const meetings = meetingsResult.meetings || [];
          logger.log(`  Found ${meetings.length} upcoming meetings`);

          for (const meeting of meetings) {
            try {
              await zoomMeetingService.syncZoomMeetingData(
                adminId,
                project._id,
                meeting.id,
              );
              totalMeetingsSynced++;
            } catch (error: any) {
              const errorMessage = error?.message || String(error);
              logger.error(
                `  Failed to sync meeting ${meeting.id}: ${errorMessage}`,
              );
              errors.push({
                projectId,
                projectName: project.projectName,
                type: 'meeting',
                id: meeting.id,
                errorMessage: errorMessage,
                error: error,
                timestamp: new Date().toISOString(),
              });
            }
          }
        } catch (error: any) {
          const errorMessage = error?.message || String(error);
          logger.error(
            `  Failed to fetch meetings for project ${project.projectName}: ${errorMessage}`,
          );
          errors.push({
            projectId,
            projectName: project.projectName,
            type: 'meeting',
            errorMessage: errorMessage,
            error: error,
            timestamp: new Date().toISOString(),
          });
        }

        // Sync Webinars
        try {
          logger.log(`  Fetching upcoming webinars for project ${project.projectName}...`);
          const webinarsResult = await zoomService.getProjectWebinars(
            adminId,
            project._id,
            'upcoming',
            { pageSize: 300 },
          );

          const webinars = webinarsResult.webinars || [];
          logger.log(`  Found ${webinars.length} upcoming webinars`);

          for (const webinar of webinars) {
            try {
              await zoomMeetingService.syncZoomWebinarData(
                adminId,
                project._id,
                webinar.id,
              );
              totalWebinarsSynced++;
            } catch (error: any) {
              const errorMessage = error?.message || String(error);
              logger.error(
                `  Failed to sync webinar ${webinar.id}: ${errorMessage}`,
              );
              errors.push({
                projectId,
                projectName: project.projectName,
                type: 'webinar',
                id: webinar.id,
                errorMessage: errorMessage,
                error: error,
                timestamp: new Date().toISOString(),
              });
            }
          }
        } catch (error: any) {
          const errorMessage = error?.message || String(error);
          // Some accounts might not have webinar permissions - this is expected
          logger.warn(
            `  Failed to fetch webinars for project ${project.projectName}: ${errorMessage}`,
          );
          errors.push({
            projectId,
            projectName: project.projectName,
            type: 'webinar',
            errorMessage: errorMessage,
            error: error,
            timestamp: new Date().toISOString(),
          });
        }

        totalProcessed++;
      } catch (error: any) {
        const errorMessage = error?.message || String(error);
        logger.error(
          `  Failed to process project ${project.projectName}: ${errorMessage}`,
        );
        errors.push({
          projectId,
          projectName: project.projectName,
          type: 'project',
          errorMessage: errorMessage,
          error: error,
          timestamp: new Date().toISOString(),

        });
      }

      if ((i + 1) % 10 === 0) {
        logger.log(
          `Progress: ${i + 1}/${projects.length} projects processed. Meetings: ${totalMeetingsSynced}, Webinars: ${totalWebinarsSynced}, Errors: ${errors.length}`,
        );
      }
    }

    // Create error report file
    logger.log('Creating sync report file...');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportFileName = `sync-zoom-errors-${timestamp}.json`;
    const reportFilePath = path.join(__dirname, reportFileName);

    const reportData: SyncReport = {
      metadata: {
        timestamp: new Date().toISOString(),
        scriptVersion: SCRIPT_VERSION,
        totalProjects: projects.length,
        totalProcessed,
        totalMeetingsSynced,
        totalWebinarsSynced,
        totalErrors: errors.length,
      },
      errors,
    };

    fs.writeFileSync(
      reportFilePath,
      JSON.stringify(reportData, null, 2),
      'utf8',
    );

    logger.log(`Sync report created: ${reportFileName}`);

    // Summary
    logger.log('Sync completed.');
    logger.log(
      `Summary: Projects: ${projects.length}, Processed: ${totalProcessed}, Meetings Synced: ${totalMeetingsSynced}, Webinars Synced: ${totalWebinarsSynced}, Errors: ${errors.length}`,
    );

    if (errors.length > 0) {
      logger.warn(
        `Warning: ${errors.length} errors occurred during sync. Check ${reportFileName} for details.`,
      );
    } else {
      logger.log('No errors occurred during sync.');
    }
  } catch (error) {
    logger.error(
      'Error during sync:',
      error?.stack ?? String(error),
    );
    throw error;
  } finally {
    await appContext.close();
  }
}

syncZoomMeetings()
  .then(() => {
    logger.log('Sync Zoom meetings script finished successfully.');
    process.exit(0);
  })
  .catch((error) => {
    logger.error(
      'Sync Zoom meetings script failed.',
      error?.stack ?? String(error),
    );
    process.exit(1);
  });
