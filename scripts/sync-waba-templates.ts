import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Document, Model, Types } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';

import { AppModule } from '../src/app.module';
import { Project, ProjectDocument } from '../src/schemas/project.schema';
import { WabaTemplateService } from '../src/whatsapp-embed/waba-template/waba-template.service';

type ProjectDocumentType = Project & Document;

interface SyncError {
  projectId: string;
  projectName: string;
  errorMessage: string;
  error: any;
  timestamp: string;
}

interface SyncResult {
  projectId: string;
  projectName: string;
  fetched: number;
  upserted: number;
  modified: number;
  deleted: number;
}

interface SyncReport {
  metadata: {
    timestamp: string;
    scriptVersion: string;
    totalProjects: number;
    totalProcessed: number;
    totalTemplatesFetched: number;
    totalTemplatesUpserted: number;
    totalTemplatesModified: number;
    totalTemplatesDeleted: number;
    totalErrors: number;
  };
  results: SyncResult[];
  errors: SyncError[];
}

const logger = new Logger('SyncWabaTemplates');
const SCRIPT_VERSION = '1.0.0';

async function syncWabaTemplates() {
  const appContext = await NestFactory.createApplicationContext(AppModule);

  try {
    const projectModel = appContext.get<Model<ProjectDocumentType>>(
      getModelToken(Project.name),
    );
    const wabaTemplateService = appContext.get<WabaTemplateService>(WabaTemplateService);

    logger.log('Starting WABA templates sync...');

    // Fetch all configured WhatsApp projects
    const projects = await projectModel.find({
      wabaId: { $exists: true, $ne: null },
      phoneNumberId: { $exists: true, $ne: null },
      permanentAccessToken: { $exists: true, $ne: null,  },
    });

    logger.log(`Found ${projects.length} configured WhatsApp projects`);

    if (projects.length === 0) {
      logger.log('No configured projects found. Nothing to sync.');
      return;
    }

    const errors: SyncError[] = [];
    const results: SyncResult[] = [];
    let totalProcessed = 0;
    let totalTemplatesFetched = 0;
    let totalTemplatesUpserted = 0;
    let totalTemplatesModified = 0;
    let totalTemplatesDeleted = 0;

    // Process each project
    for (let i = 0; i < projects.length; i++) {
      const project = projects[i];
      const projectId = project._id instanceof Types.ObjectId 
        ? project._id.toString() 
        : String(project._id);
      const adminId = project.adminId instanceof Types.ObjectId
        ? project.adminId
        : new Types.ObjectId(String(project.adminId));

      logger.log(
        `Processing project ${i + 1}/${projects.length}: ${project.projectName} (${projectId})`,
      );

      try {
        logger.log(`  Syncing WABA templates for project ${project.projectName}...`);
        
        const syncResult = await wabaTemplateService.syncWabaTemplates(
          adminId,
          project._id as Types.ObjectId,
        );

        totalTemplatesFetched += syncResult.fetched;
        totalTemplatesUpserted += syncResult.upserted;
        totalTemplatesModified += syncResult.modified;
        totalTemplatesDeleted += syncResult.deleted;

        results.push({
          projectId,
          projectName: project.projectName,
          fetched: syncResult.fetched,
          upserted: syncResult.upserted,
          modified: syncResult.modified,
          deleted: syncResult.deleted,
        });

        logger.log(
          `  Sync completed for ${project.projectName}: fetched=${syncResult.fetched}, upserted=${syncResult.upserted}, modified=${syncResult.modified}, deleted=${syncResult.deleted}`,
        );

        totalProcessed++;
      } catch (error: any) {
        const errorMessage = error?.message || String(error);
        logger.error(
          `  Failed to sync templates for project ${project.projectName}: ${errorMessage}`,
        );
        errors.push({
          projectId,
          projectName: project.projectName,
          errorMessage: errorMessage,
          error: {
            message: error?.message,
            name: error?.name,
            code: error?.code,
            response: error?.response?.data,
          },
          timestamp: new Date().toISOString(),
        });
      }

      // Log progress every 10 projects
      if ((i + 1) % 10 === 0) {
        logger.log(
          `Progress: ${i + 1}/${projects.length} projects processed. Templates: fetched=${totalTemplatesFetched}, upserted=${totalTemplatesUpserted}, modified=${totalTemplatesModified}, deleted=${totalTemplatesDeleted}, Errors: ${errors.length}`,
        );
      }
    }

    // Create sync report file
    logger.log('Creating sync report file...');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportFileName = `sync-waba-templates-${timestamp}.json`;
    const reportFilePath = path.join(__dirname, reportFileName);

    const reportData: SyncReport = {
      metadata: {
        timestamp: new Date().toISOString(),
        scriptVersion: SCRIPT_VERSION,
        totalProjects: projects.length,
        totalProcessed,
        totalTemplatesFetched,
        totalTemplatesUpserted,
        totalTemplatesModified,
        totalTemplatesDeleted,
        totalErrors: errors.length,
      },
      results,
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
      `Summary: Projects: ${projects.length}, Processed: ${totalProcessed}, Templates Fetched: ${totalTemplatesFetched}, Upserted: ${totalTemplatesUpserted}, Modified: ${totalTemplatesModified}, Deleted: ${totalTemplatesDeleted}, Errors: ${errors.length}`,
    );

    if (errors.length > 0) {
      logger.warn(
        `Warning: ${errors.length} errors occurred during sync. Check ${reportFileName} for details.`,
      );
    } else {
      logger.log('No errors occurred during sync.');
    }
  } catch (error: any) {
    logger.error(
      'Error during sync:',
      error?.stack ?? String(error),
    );
    throw error;
  } finally {
    await appContext.close();
  }
}

syncWabaTemplates()
  .then(() => {
    logger.log('Sync WABA templates script finished successfully.');
    process.exit(0);
  })
  .catch((error) => {
    logger.error(
      'Sync WABA templates script failed.',
      error?.stack ?? String(error),
    );
    process.exit(1);
  });
