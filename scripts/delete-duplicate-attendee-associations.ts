import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Document, Model, Types } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';

import { AppModule } from '../src/app.module';
import { AttendeeAssociation } from '../src/schemas/attendee-association.schema';

type AttendeeAssociationDocument = AttendeeAssociation & Document;

interface BackupMetadata {
  timestamp: string;
  scriptVersion: string;
  totalDuplicateGroups: number;
  totalDeleted: number;
  totalKept: number;
}

interface BackupFile {
  metadata: BackupMetadata;
  deletedAssociations: any[];
}

const logger = new Logger('DeleteDuplicateAttendeeAssociations');
const SCRIPT_VERSION = '1.0.0';

async function deleteDuplicateAssociations() {
  const appContext = await NestFactory.createApplicationContext(AppModule);

  try {
    const associationModel = appContext.get<Model<AttendeeAssociationDocument>>(
      getModelToken(AttendeeAssociation.name),
    );

    logger.log('Starting duplicate attendee association detection and deletion...');

    // Step 1: Find all duplicate groups using aggregation
    logger.log('Finding duplicate attendee association groups...');
    const duplicateGroups = await associationModel.aggregate([
      {
        $group: {
          _id: {
            adminId: '$adminId',
            email: '$email',
            leadType: '$leadType',
          },
          count: { $sum: 1 },
          associations: {
            $push: {
              _id: '$_id',
              createdAt: '$createdAt',
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
    logger.log(`Found ${totalDuplicateGroups} duplicate attendee association groups`);

    if (totalDuplicateGroups === 0) {
      logger.log('No duplicate attendee associations found. Nothing to delete.');
      return;
    }

    // Step 2: Process each duplicate group
    const deletedAssociations: AttendeeAssociationDocument[] = [];
    let totalDeleted = 0;
    let totalKept = 0;
    let failed = 0;

    for (let i = 0; i < duplicateGroups.length; i++) {
      const group = duplicateGroups[i];
      const groupKey = `${group._id.adminId}-${group._id.email}-${group._id.leadType}`;

      try {
        // Sort associations by createdAt (oldest first), fallback to _id timestamp if createdAt is missing
        const sortedAssociations = group.associations.sort((a: any, b: any) => {
          const getTimestamp = (assoc: any): number => {
            if (assoc.createdAt) {
              return new Date(assoc.createdAt).getTime();
            }
            const id =
              assoc._id instanceof Types.ObjectId
                ? assoc._id
                : new Types.ObjectId(assoc._id);
            return id.getTimestamp().getTime();
          };
          return getTimestamp(a) - getTimestamp(b);
        });

        const toKeep = sortedAssociations[0];
        const toDelete = sortedAssociations.slice(1);

        logger.log(
          `Group ${i + 1}/${totalDuplicateGroups}: Keeping oldest association ${toKeep._id}, deleting ${toDelete.length} duplicate(s)`,
        );

        const idsToDelete = toDelete.map(
          (assoc: any) =>
            (assoc._id instanceof Types.ObjectId
              ? assoc._id
              : new Types.ObjectId(assoc._id)) as Types.ObjectId,
        );

        // Fetch full documents for backup before deletion
        const fullDocuments = await associationModel.find({
          _id: { $in: idsToDelete },
        });

        for (const doc of fullDocuments) {
          deletedAssociations.push(doc);
        }

        // Delete duplicate associations
        const deleteResult = await associationModel.deleteMany({
          _id: { $in: idsToDelete },
        });

        totalDeleted += deleteResult.deletedCount ?? 0;
        totalKept += 1;

        if ((i + 1) % 50 === 0) {
          logger.log(
            `Progress: ${i + 1}/${totalDuplicateGroups} groups processed. Deleted: ${totalDeleted}, Kept: ${totalKept}`,
          );
        }
      } catch (error) {
        failed += 1;
        logger.error(
          `Failed to process duplicate group ${groupKey}: ${error?.message ?? String(
            error,
          )}`,
          error?.stack,
        );
      }
    }

    // Step 3: Create backup file
    logger.log('Creating attendee association backup file...');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `attendee-associations-backup-${timestamp}.json`;
    const backupFilePath = path.join(__dirname, backupFileName);

    const serializedAssociations = deletedAssociations.map((assoc) => {
      const plain = assoc.toObject ? assoc.toObject() : JSON.parse(JSON.stringify(assoc));

      if (plain._id && Types.ObjectId.isValid(plain._id)) {
        plain._id = plain._id.toString();
      }
      if (plain.adminId && Types.ObjectId.isValid(plain.adminId)) {
        plain.adminId = plain.adminId.toString();
      }
      if (plain.leadType && Types.ObjectId.isValid(plain.leadType)) {
        plain.leadType = plain.leadType.toString();
      }

      return plain;
    });

    const backupData: BackupFile = {
      metadata: {
        timestamp: new Date().toISOString(),
        scriptVersion: SCRIPT_VERSION,
        totalDuplicateGroups,
        totalDeleted,
        totalKept,
      },
      deletedAssociations: serializedAssociations,
    };

    fs.writeFileSync(
      backupFilePath,
      JSON.stringify(backupData, null, 2),
      'utf8',
    );

    logger.log(`Backup file created: ${backupFileName}`);

    // Step 4: Verify and report
    logger.log('Duplicate attendee association deletion completed.');
    logger.log(
      `Summary: Groups: ${totalDuplicateGroups}, Deleted: ${totalDeleted}, Kept: ${totalKept}, Failed: ${failed}`,
    );

    if (failed > 0) {
      logger.warn(
        `Warning: ${failed} duplicate groups failed to process. Check logs for details.`,
      );
    }

    // Verify no duplicates remain
    const remainingDuplicates = await associationModel.aggregate([
      {
        $group: {
          _id: {
            adminId: '$adminId',
            email: '$email',
            leadType: '$leadType',
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
        `Warning: ${remainingDuplicates.length} duplicate attendee association groups still remain. You may need to run this script again.`,
      );
    } else {
      logger.log('Verification: No duplicate attendee associations remain in the collection.');
    }
  } catch (error) {
    logger.error(
      'Error during attendee association duplicate deletion:',
      error?.stack ?? String(error),
    );
    throw error;
  } finally {
    await appContext.close();
  }
}

deleteDuplicateAssociations()
  .then(() => {
    logger.log('Delete duplicate attendee associations script finished successfully.');
    process.exit(0);
  })
  .catch((error) => {
    logger.error(
      'Delete duplicate attendee associations script failed.',
      error?.stack ?? String(error),
    );
    process.exit(1);
  });

