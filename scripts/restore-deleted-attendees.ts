import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Document, Model, Types } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';

import { AppModule } from '../src/app.module';
import { Attendee } from '../src/schemas/Attendee.schema';

type AttendeeDocument = Attendee & Document;

interface BackupMetadata {
  timestamp: string;
  scriptVersion: string;
  totalDuplicatesFound: number;
  totalDeleted: number;
  totalKept: number;
  duplicateGroups: number;
}

interface BackupFile {
  metadata: BackupMetadata;
  deletedAttendees: any[];
}

const logger = new Logger('RestoreDeletedAttendees');

async function restoreAttendees() {
  const appContext = await NestFactory.createApplicationContext(AppModule);

  try {
    // Get backup filename from command line argument or list available files
    const backupFileName = process.argv[2];

    if (!backupFileName) {
      logger.error('No backup file specified.');
      logger.log('Usage: npm run restore:deleted-attendees <backup-filename>');
      logger.log('Example: npm run restore:deleted-attendees attendees-backup-2024-01-15T10-30-00-000Z.json');
      logger.log('');
      logger.log('Available backup files in scripts/ directory:');
      
      const scriptsDir = __dirname;
      const files = fs.readdirSync(scriptsDir);
      const backupFiles = files.filter((file) => 
        file.startsWith('attendees-backup-') && file.endsWith('.json')
      );
      
      if (backupFiles.length === 0) {
        logger.warn('No backup files found.');
      } else {
        backupFiles.forEach((file) => {
          logger.log(`  - ${file}`);
        });
      }
      
      process.exit(1);
      return;
    }

    const backupFilePath = path.join(__dirname, backupFileName);

    // Check if backup file exists
    if (!fs.existsSync(backupFilePath)) {
      logger.error(`Backup file not found: ${backupFileName}`);
      logger.error(`Expected path: ${backupFilePath}`);
      process.exit(1);
      return;
    }

    logger.log(`Reading backup file: ${backupFileName}`);

    // Read and parse backup file
    const backupContent = fs.readFileSync(backupFilePath, 'utf8');
    let backupData: BackupFile;

    try {
      backupData = JSON.parse(backupContent);
    } catch (error) {
      logger.error(`Failed to parse backup file: ${error?.message ?? String(error)}`);
      process.exit(1);
      return;
    }

    // Validate backup file structure
    if (!backupData.metadata || !backupData.deletedAttendees) {
      logger.error('Invalid backup file format. Missing metadata or deletedAttendees.');
      process.exit(1);
      return;
    }

    logger.log(`Backup file metadata:`);
    logger.log(`  - Timestamp: ${backupData.metadata.timestamp}`);
    logger.log(`  - Script Version: ${backupData.metadata.scriptVersion}`);
    logger.log(`  - Total Deleted: ${backupData.metadata.totalDeleted}`);
    logger.log(`  - Deleted Attendees in file: ${backupData.deletedAttendees.length}`);

    if (backupData.deletedAttendees.length === 0) {
      logger.warn('No deleted attendees found in backup file. Nothing to restore.');
      return;
    }

    const attendeeModel = appContext.get<Model<AttendeeDocument>>(
      getModelToken(Attendee.name),
    );

    logger.log('Starting restoration of deleted attendees...');

    // Convert backup data back to Mongoose documents
    let restored = 0;
    let skipped = 0;
    let failed = 0;
    const batchSize = 100;

    // Process in batches for better performance and error handling
    for (let i = 0; i < backupData.deletedAttendees.length; i += batchSize) {
      const batch = backupData.deletedAttendees.slice(i, i + batchSize);
      
      for (const attendeeData of batch) {
        try {
          // Convert string ObjectIds back to ObjectId instances
          const restoredAttendee: any = { ...attendeeData };

          // Convert _id
          if (restoredAttendee._id && typeof restoredAttendee._id === 'string') {
            restoredAttendee._id = new Types.ObjectId(restoredAttendee._id);
          }

          // Convert nested ObjectIds
          if (restoredAttendee.adminId && typeof restoredAttendee.adminId === 'string') {
            restoredAttendee.adminId = new Types.ObjectId(restoredAttendee.adminId);
          }
          if (restoredAttendee.webinar && typeof restoredAttendee.webinar === 'string') {
            restoredAttendee.webinar = new Types.ObjectId(restoredAttendee.webinar);
          }
          if (restoredAttendee.assignedTo && typeof restoredAttendee.assignedTo === 'string') {
            restoredAttendee.assignedTo = new Types.ObjectId(restoredAttendee.assignedTo);
          }
          if (restoredAttendee.tempAssignedTo && typeof restoredAttendee.tempAssignedTo === 'string') {
            restoredAttendee.tempAssignedTo = new Types.ObjectId(restoredAttendee.tempAssignedTo);
          }

          // Check if attendee already exists (by _id)
          const existing = await attendeeModel.findById(restoredAttendee._id);
          
          if (existing) {
            logger.warn(
              `Skipping attendee ${restoredAttendee._id} - already exists in collection`,
            );
            skipped += 1;
            continue;
          }

          // Remove _id temporarily to let MongoDB generate a new one, or keep it if you want to restore exact _id
          // For safety, we'll keep the original _id to restore exactly as it was
          const newAttendee = new attendeeModel(restoredAttendee);
          await newAttendee.save();

          restored += 1;

          if (restored % 50 === 0) {
            logger.log(
              `Progress: ${restored}/${backupData.deletedAttendees.length} attendees restored...`,
            );
          }
        } catch (error) {
          failed += 1;
          const attendeeId = attendeeData._id || 'unknown';
          logger.error(
            `Failed to restore attendee ${attendeeId}: ${error?.message ?? String(error)}`,
            error?.stack,
          );
        }
      }
    }

    // Final summary
    logger.log('Restoration completed.');
    logger.log(
      `Summary: Restored: ${restored}, Skipped: ${skipped}, Failed: ${failed}`,
    );

    if (failed > 0) {
      logger.warn(
        `Warning: ${failed} attendees failed to restore. Check logs for details.`,
      );
    }

    if (skipped > 0) {
      logger.log(
        `Note: ${skipped} attendees were skipped because they already exist in the collection.`,
      );
    }

    // Verify restoration
    const totalInCollection = await attendeeModel.countDocuments();
    logger.log(`Total attendees in collection after restoration: ${totalInCollection}`);
  } catch (error) {
    logger.error(
      'Error during restoration:',
      error?.stack ?? String(error),
    );
    throw error;
  } finally {
    await appContext.close();
  }
}

restoreAttendees()
  .then(() => {
    logger.log('Restore script finished successfully.');
    process.exit(0);
  })
  .catch((error) => {
    logger.error(
      'Restore script failed.',
      error?.stack ?? String(error),
    );
    process.exit(1);
  });
