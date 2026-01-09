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

const logger = new Logger('DeleteDuplicateAttendees');
const SCRIPT_VERSION = '1.0.0';

async function deleteDuplicates() {
  const appContext = await NestFactory.createApplicationContext(AppModule);

  try {
    const attendeeModel = appContext.get<Model<AttendeeDocument>>(
      getModelToken(Attendee.name),
    );

    logger.log('Starting duplicate attendee detection and deletion...');

    // Step 1: Find all duplicate groups using aggregation
    logger.log('Finding duplicate groups...');
    const duplicateGroups = await attendeeModel.aggregate([
      {
        $match: {
          adminId: { $exists: true, $ne: null },
          webinar: { $exists: true, $ne: null },
          email: { $exists: true, $ne: null },
          isAttended: { $exists: true },
        },
      },
      {
        $group: {
          _id: {
            adminId: '$adminId',
            webinar: '$webinar',
            isAttended: '$isAttended',
            email: '$email',
          },
          count: { $sum: 1 },
          attendees: {
            $push: {
              _id: '$_id',
              createdAt: '$createdAt',
              document: '$$ROOT',
            },
          },
        },
      },
      {
        $match: {
          count: { $gt: 1 },
        },
      },
    ]);

    const totalDuplicateGroups = duplicateGroups.length;
    logger.log(`Found ${totalDuplicateGroups} duplicate groups`);

    if (totalDuplicateGroups === 0) {
      logger.log('No duplicates found. Nothing to delete.');
      return;
    }

    // Step 2: Process each duplicate group
    const deletedAttendees: any[] = [];
    let totalDeleted = 0;
    let totalKept = 0;
    let failed = 0;

    for (let i = 0; i < duplicateGroups.length; i++) {
      const group = duplicateGroups[i];
      const groupKey = `${group._id.adminId}-${group._id.webinar}-${group._id.isAttended}-${group._id.email}`;

      try {
        // Sort attendees by createdAt (oldest first), fallback to _id if createdAt is missing
        const sortedAttendees = group.attendees.sort((a, b) => {
          const getTimestamp = (attendee: any): number => {
            if (attendee.createdAt) {
              return new Date(attendee.createdAt).getTime();
            }
            // Fallback to ObjectId timestamp
            const id =
              attendee._id instanceof Types.ObjectId
                ? attendee._id
                : new Types.ObjectId(attendee._id);
            return id.getTimestamp().getTime();
          };
          return getTimestamp(a) - getTimestamp(b);
        });

        // Keep the first (oldest) one, delete the rest
        const toKeep = sortedAttendees[0];
        const toDelete = sortedAttendees.slice(1);

        logger.log(
          `Group ${i + 1}/${totalDuplicateGroups}: Keeping oldest attendee ${toKeep._id}, deleting ${toDelete.length} duplicate(s)`,
        );

        // Fetch full documents for backup before deletion
        const idsToDelete = toDelete.map((a) => new Types.ObjectId(a._id));
        const fullDocuments = await attendeeModel.find({
          _id: { $in: idsToDelete },
        });

        // Collect deleted attendees for backup
        for (const doc of fullDocuments) {
          deletedAttendees.push(doc);
        }

        // Delete duplicates
        const deleteResult = await attendeeModel.deleteMany({
          _id: { $in: idsToDelete },
        });

        totalDeleted += deleteResult.deletedCount;
        totalKept += 1;

        if ((i + 1) % 50 === 0) {
          logger.log(
            `Progress: ${i + 1}/${totalDuplicateGroups} groups processed. Deleted: ${totalDeleted}, Kept: ${totalKept}`,
          );
        }
      } catch (error) {
        failed += 1;
        logger.error(
          `Failed to process duplicate group ${groupKey}: ${error?.message ?? String(error)}`,
          error?.stack,
        );
      }
    }

    // Step 3: Create backup files (JSON and TXT)
    logger.log('Creating backup files...');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `attendees-backup-${timestamp}.json`;
    const backupTextFileName = `attendees-backup-${timestamp}.txt`;
    const backupFilePath = path.join(__dirname, backupFileName);
    const backupTextFilePath = path.join(__dirname, backupTextFileName);

    const serializedAttendees = deletedAttendees.map((attendee) => {
      // Convert to plain object and handle ObjectId serialization
      const plain = attendee.toObject
        ? attendee.toObject()
        : JSON.parse(JSON.stringify(attendee));
      // Ensure _id is properly serialized
      if (plain._id && Types.ObjectId.isValid(plain._id)) {
        plain._id = plain._id.toString();
      }
      // Handle nested ObjectIds
      if (plain.adminId && Types.ObjectId.isValid(plain.adminId)) {
        plain.adminId = plain.adminId.toString();
      }
      if (plain.webinar && Types.ObjectId.isValid(plain.webinar)) {
        plain.webinar = plain.webinar.toString();
      }
      if (plain.assignedTo && Types.ObjectId.isValid(plain.assignedTo)) {
        plain.assignedTo = plain.assignedTo.toString();
      }
      if (
        plain.tempAssignedTo &&
        Types.ObjectId.isValid(plain.tempAssignedTo)
      ) {
        plain.tempAssignedTo = plain.tempAssignedTo.toString();
      }
      return plain;
    });

    const backupData: BackupFile = {
      metadata: {
        timestamp: new Date().toISOString(),
        scriptVersion: SCRIPT_VERSION,
        totalDuplicatesFound: duplicateGroups.reduce(
          (sum, g) => sum + g.count,
          0,
        ),
        totalDeleted: totalDeleted,
        totalKept: totalKept,
        duplicateGroups: totalDuplicateGroups,
      },
      deletedAttendees: serializedAttendees,
    };

    // Write JSON backup file
    fs.writeFileSync(
      backupFilePath,
      JSON.stringify(backupData, null, 2),
      'utf8',
    );

    logger.log(`JSON backup file created: ${backupFileName}`);

    // Write text backup file
    let textContent = 'DELETED ATTENDEES BACKUP\n';
    textContent += '='.repeat(80) + '\n\n';
    textContent += `Backup Timestamp: ${backupData.metadata.timestamp}\n`;
    textContent += `Script Version: ${backupData.metadata.scriptVersion}\n`;
    textContent += `Total Duplicates Found: ${backupData.metadata.totalDuplicatesFound}\n`;
    textContent += `Total Deleted: ${backupData.metadata.totalDeleted}\n`;
    textContent += `Total Kept: ${backupData.metadata.totalKept}\n`;
    textContent += `Duplicate Groups: ${backupData.metadata.duplicateGroups}\n`;
    textContent += '\n' + '='.repeat(80) + '\n\n';

    serializedAttendees.forEach((attendee, index) => {
      textContent += `\n[${index + 1}/${serializedAttendees.length}] DELETED ATTENDEE\n`;
      textContent += '-'.repeat(80) + '\n';
      textContent += `ID: ${attendee._id || 'N/A'}\n`;
      textContent += `Email: ${attendee.email || 'N/A'}\n`;
      textContent += `First Name: ${attendee.firstName || 'N/A'}\n`;
      textContent += `Last Name: ${attendee.lastName || 'N/A'}\n`;
      textContent += `Phone: ${attendee.phone || 'N/A'}\n`;
      textContent += `Admin ID: ${attendee.adminId || 'N/A'}\n`;
      textContent += `Webinar ID: ${attendee.webinar || 'N/A'}\n`;
      textContent += `Is Attended: ${attendee.isAttended !== undefined ? attendee.isAttended : 'N/A'}\n`;
      textContent += `Status: ${attendee.status || 'N/A'}\n`;
      textContent += `Assigned To: ${attendee.assignedTo || 'N/A'}\n`;
      textContent += `Temp Assigned To: ${attendee.tempAssignedTo || 'N/A'}\n`;
      textContent += `Source: ${attendee.source || 'N/A'}\n`;
      textContent += `Valid Call: ${attendee.validCall !== undefined ? attendee.validCall : 'N/A'}\n`;
      textContent += `Is Pulledback: ${attendee.isPulledback !== undefined ? attendee.isPulledback : 'N/A'}\n`;
      textContent += `Is Deleted: ${attendee.isDeleted !== undefined ? attendee.isDeleted : 'N/A'}\n`;
      textContent += `Time In Session: ${attendee.timeInSession || 0}\n`;
      textContent += `Gender: ${attendee.gender || 'N/A'}\n`;
      textContent += `Location: ${attendee.location || 'N/A'}\n`;
      textContent += `Created At: ${attendee.createdAt || 'N/A'}\n`;
      textContent += `Updated At: ${attendee.updatedAt || 'N/A'}\n`;
      textContent += '\n';
    });

    textContent += '\n' + '='.repeat(80) + '\n';
    textContent += `END OF BACKUP - Total: ${serializedAttendees.length} deleted attendees\n`;

    fs.writeFileSync(backupTextFilePath, textContent, 'utf8');

    logger.log(`Text backup file created: ${backupTextFileName}`);

    // Step 4: Verify and report
    logger.log('Duplicate deletion completed.');
    logger.log(
      `Summary: Groups: ${totalDuplicateGroups}, Deleted: ${totalDeleted}, Kept: ${totalKept}, Failed: ${failed}`,
    );

    if (failed > 0) {
      logger.warn(
        `Warning: ${failed} duplicate groups failed to process. Check logs for details.`,
      );
    }

    // Verify no duplicates remain
    const remainingDuplicates = await attendeeModel.aggregate([
      {
        $match: {
          adminId: { $exists: true, $ne: null },
          webinar: { $exists: true, $ne: null },
          email: { $exists: true, $ne: null },
          isAttended: { $exists: true },
        },
      },
      {
        $group: {
          _id: {
            adminId: '$adminId',
            webinar: '$webinar',
            isAttended: '$isAttended',
            email: '$email',
          },
          count: { $sum: 1 },
        },
      },
      {
        $match: {
          count: { $gt: 1 },
        },
      },
    ]);

    if (remainingDuplicates.length > 0) {
      logger.warn(
        `Warning: ${remainingDuplicates.length} duplicate groups still remain. You may need to run this script again.`,
      );
    } else {
      logger.log('Verification: No duplicates remain in the collection.');
    }
  } catch (error) {
    logger.error(
      'Error during duplicate deletion:',
      error?.stack ?? String(error),
    );
    throw error;
  } finally {
    await appContext.close();
  }
}

deleteDuplicates()
  .then(() => {
    logger.log('Delete duplicates script finished successfully.');
    process.exit(0);
  })
  .catch((error) => {
    logger.error(
      'Delete duplicates script failed.',
      error?.stack ?? String(error),
    );
    process.exit(1);
  });
