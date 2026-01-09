import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Document, Model, Types } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';

import { AppModule } from '../src/app.module';
import { Assignments } from '../src/schemas/Assignments.schema';

type AssignmentsDocument = Assignments & Document;

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

const logger = new Logger('DeleteAssignmentsForDeletedAttendees');

async function deleteAssignments() {
  const appContext = await NestFactory.createApplicationContext(AppModule);

  try {
    // Get backup filename from command line argument or list available files
    const backupFileName = process.argv[2];

    if (!backupFileName) {
      logger.error('No backup file specified.');
      logger.log('Usage: npm run delete:assignments-for-deleted-attendees <backup-filename>');
      logger.log('Example: npm run delete:assignments-for-deleted-attendees attendees-backup-2024-01-15T10-30-00-000Z.json');
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
    logger.log(`  - Total Deleted Attendees: ${backupData.deletedAttendees.length}`);

    if (backupData.deletedAttendees.length === 0) {
      logger.warn('No deleted attendees found in backup file. Nothing to process.');
      return;
    }

    // Filter attendees with assignedTo or tempAssignedTo not null
    const attendeesWithAssignments = backupData.deletedAttendees.filter(
      (attendee) => 
        (attendee.assignedTo !== null && attendee.assignedTo !== undefined) ||
        (attendee.tempAssignedTo !== null && attendee.tempAssignedTo !== undefined)
    );

    logger.log(`Found ${attendeesWithAssignments.length} deleted attendees with assignments (assignedTo or tempAssignedTo not null)`);

    if (attendeesWithAssignments.length === 0) {
      logger.log('No attendees with assignments found. Nothing to delete.');
      return;
    }

    const assignmentsModel = appContext.get<Model<AssignmentsDocument>>(
      getModelToken(Assignments.name),
    );

    // Extract attendee IDs
    const attendeeIds = attendeesWithAssignments
      .map((attendee) => {
        if (attendee._id && typeof attendee._id === 'string') {
          return new Types.ObjectId(attendee._id);
        }
        return null;
      })
      .filter((id): id is Types.ObjectId => id !== null);

    if (attendeeIds.length === 0) {
      logger.warn('No valid attendee IDs found. Cannot proceed.');
      return;
    }

    logger.log(`Processing ${attendeeIds.length} attendee IDs...`);

    // Find all assignments for these attendees
    const assignments = await assignmentsModel.find({
      attendee: { $in: attendeeIds },
    });

    logger.log(`Found ${assignments.length} assignments to delete`);

    if (assignments.length === 0) {
      logger.log('No assignments found for these attendees. Nothing to delete.');
      return;
    }

    // Log assignment details before deletion
    logger.log('Assignments to be deleted:');
    assignments.forEach((assignment, index) => {
      logger.log(
        `  [${index + 1}/${assignments.length}] Assignment ID: ${assignment._id}, Attendee: ${assignment.attendee}, User: ${assignment.user}, Status: ${assignment.status}`,
      );
    });

    // Delete assignments
    const deleteResult = await assignmentsModel.deleteMany({
      attendee: { $in: attendeeIds },
    });

    logger.log('Assignments deletion completed.');
    logger.log(
      `Summary: Found ${assignments.length} assignments, Deleted: ${deleteResult.deletedCount}`,
    );

    // Verify deletion
    const remainingAssignments = await assignmentsModel.countDocuments({
      attendee: { $in: attendeeIds },
    });

    if (remainingAssignments > 0) {
      logger.warn(
        `Warning: ${remainingAssignments} assignments still remain for these attendees.`,
      );
    } else {
      logger.log('Verification: All assignments for deleted attendees have been removed.');
    }

    // Create a summary report
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportFileName = `assignments-deletion-report-${timestamp}.txt`;
    const reportFilePath = path.join(__dirname, reportFileName);

    let reportContent = 'ASSIGNMENTS DELETION REPORT\n';
    reportContent += '='.repeat(80) + '\n\n';
    reportContent += `Backup File: ${backupFileName}\n`;
    reportContent += `Report Timestamp: ${new Date().toISOString()}\n`;
    reportContent += `Total Deleted Attendees in Backup: ${backupData.deletedAttendees.length}\n`;
    reportContent += `Attendees with Assignments: ${attendeesWithAssignments.length}\n`;
    reportContent += `Assignments Found: ${assignments.length}\n`;
    reportContent += `Assignments Deleted: ${deleteResult.deletedCount}\n`;
    reportContent += `Remaining Assignments: ${remainingAssignments}\n`;
    reportContent += '\n' + '='.repeat(80) + '\n\n';

    reportContent += 'DELETED ASSIGNMENTS DETAILS:\n';
    reportContent += '-'.repeat(80) + '\n';
    assignments.forEach((assignment, index) => {
      reportContent += `\n[${index + 1}/${assignments.length}] Assignment\n`;
      reportContent += `  ID: ${assignment._id}\n`;
      reportContent += `  Attendee ID: ${assignment.attendee}\n`;
      reportContent += `  User ID: ${assignment.user}\n`;
      reportContent += `  Admin ID: ${assignment.adminId}\n`;
      reportContent += `  Webinar ID: ${assignment.webinar}\n`;
      reportContent += `  Status: ${assignment.status}\n`;
      reportContent += `  Record Type: ${assignment.recordType}\n`;
      reportContent += `  Is Temporary: ${assignment.isTemporary || false}\n`;
      reportContent += `  Request Reason: ${assignment.requestReason || 'N/A'}\n`;
    });

    reportContent += '\n' + '='.repeat(80) + '\n';
    reportContent += `END OF REPORT\n`;

    fs.writeFileSync(reportFilePath, reportContent, 'utf8');
    logger.log(`Deletion report created: ${reportFileName}`);
  } catch (error) {
    logger.error(
      'Error during assignments deletion:',
      error?.stack ?? String(error),
    );
    throw error;
  } finally {
    await appContext.close();
  }
}

deleteAssignments()
  .then(() => {
    logger.log('Delete assignments script finished successfully.');
    process.exit(0);
  })
  .catch((error) => {
    logger.error(
      'Delete assignments script failed.',
      error?.stack ?? String(error),
    );
    process.exit(1);
  });
