import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Document, Model, Types } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';

import { AppModule } from '../src/app.module';
import { AttendeeAssociation } from '../src/attendee-association/attendee-association.schema';

type AttendeeAssociationDocument = AttendeeAssociation & Document;

const logger = new Logger('RemoveUndefinedFromFullNames');

async function removeUndefinedFromFullNames() {
  const appContext = await NestFactory.createApplicationContext(AppModule);

  try {
    const associationModel = appContext.get<Model<AttendeeAssociationDocument>>(
      getModelToken(AttendeeAssociation.name),
    );

    logger.log('Starting removal of "undefined" strings from fullNames arrays...');

    // Find all associations with fullNames containing "undefined" as exact match or substring
    const associationsWithUndefined = await associationModel.aggregate([
      {
        $match: {
          fullNames: { $exists: true, $ne: [] },
        },
      },
      {
        $match: {
          $expr: {
            $gt: [
              {
                $size: {
                  $filter: {
                    input: '$fullNames',
                    as: 'name',
                    cond: {
                      $regexMatch: {
                        input: { $toString: '$$name' },
                        regex: /undefined/i,
                      },
                    },
                  },
                },
              },
              0,
            ],
          },
        },
      },
    ]);

    logger.log(
      `Found ${associationsWithUndefined.length} associations with "undefined" in fullNames (exact or substring)`,
    );

    if (associationsWithUndefined.length === 0) {
      logger.log('No associations with "undefined" in fullNames found. Nothing to clean.');
      return;
    }

    let processed = 0;
    let updated = 0;
    let failed = 0;
    const cleanedAssociations: any[] = [];

    for (const association of associationsWithUndefined) {
      try {
        const originalFullNames = [...(association.fullNames || [])];
        const nameChanges: Array<{
          original: string;
          cleaned: string | null;
          action: 'removed' | 'cleaned' | 'unchanged';
        }> = [];

        // Enhanced cleaning logic: handle both direct matches and substring matches
        const cleanedFullNames = originalFullNames
          .map((name) => {
            if (!name || name === null || name === undefined) {
              nameChanges.push({
                original: String(name),
                cleaned: null,
                action: 'removed',
              });
              return null;
            }

            const nameStr = name.toString();
            const lowerName = nameStr.toLowerCase().trim();

            // Direct match: return null to remove entire entry
            if (lowerName === 'undefined') {
              nameChanges.push({
                original: nameStr,
                cleaned: null,
                action: 'removed',
              });
              return null;
            }

            // Substring match: remove "undefined" and trim
            if (lowerName.includes('undefined')) {
              const cleaned = nameStr.replace(/\bundefined\b/gi, '').trim();
              if (cleaned && cleaned !== '') {
                nameChanges.push({
                  original: nameStr,
                  cleaned: cleaned,
                  action: 'cleaned',
                });
                return cleaned;
              } else {
                nameChanges.push({
                  original: nameStr,
                  cleaned: null,
                  action: 'removed',
                });
                return null;
              }
            }

            // No "undefined" found: keep as is (but trim)
            const trimmed = nameStr.trim();
            if (trimmed && trimmed !== '') {
              nameChanges.push({
                original: nameStr,
                cleaned: trimmed,
                action: trimmed !== nameStr ? 'cleaned' : 'unchanged',
              });
              return trimmed;
            } else {
              nameChanges.push({
                original: nameStr,
                cleaned: null,
                action: 'removed',
              });
              return null;
            }
          })
          .filter((name): name is string => name !== null && name !== '');

        // Check if there are any changes
        const hasChanges =
          cleanedFullNames.length !== originalFullNames.length ||
          nameChanges.some((change) => change.action !== 'unchanged');

        // Only update if there are changes
        if (hasChanges) {
          await associationModel.findByIdAndUpdate(
            association._id,
            {
              $set: {
                fullNames: cleanedFullNames,
              },
            },
            { new: true },
          );

          const removedCount = nameChanges.filter(
            (change) => change.action === 'removed',
          ).length;
          const cleanedCount = nameChanges.filter(
            (change) => change.action === 'cleaned',
          ).length;

          // Handle ObjectId conversion for report
          const associationId =
            association._id instanceof Types.ObjectId
              ? association._id.toString()
              : String(association._id);
          const adminIdStr =
            association.adminId instanceof Types.ObjectId
              ? association.adminId.toString()
              : String(association.adminId);

          cleanedAssociations.push({
            _id: associationId,
            email: association.email,
            adminId: adminIdStr,
            originalFullNames: originalFullNames,
            cleanedFullNames: cleanedFullNames,
            removedCount: removedCount,
            cleanedCount: cleanedCount,
            nameChanges: nameChanges,
          });

          updated += 1;
        }

        processed += 1;

        if (processed % 100 === 0) {
          logger.log(
            `Progress: ${processed}/${associationsWithUndefined.length} associations processed. Updated: ${updated}`,
          );
        }
      } catch (error) {
        failed += 1;
        logger.error(
          `Failed to process association ${association._id}: ${error?.message ?? String(error)}`,
          error?.stack,
        );
      }
    }

    // Verify cleanup - check for both exact matches and substring matches
    logger.log('Verifying cleanup...');
    const remainingWithUndefined = await associationModel.aggregate([
      {
        $match: {
          fullNames: { $exists: true, $ne: [] },
        },
      },
      {
        $match: {
          $expr: {
            $gt: [
              {
                $size: {
                  $filter: {
                    input: '$fullNames',
                    as: 'name',
                    cond: {
                      $regexMatch: {
                        input: { $toString: '$$name' },
                        regex: /undefined/i,
                      },
                    },
                  },
                },
              },
              0,
            ],
          },
        },
      },
      {
        $count: 'count',
      },
    ]);

    const remainingCount =
      remainingWithUndefined.length > 0 ? remainingWithUndefined[0].count : 0;

    // Create backup/report file
    logger.log('Creating cleanup report file...');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportFileName = `fullnames-cleanup-report-${timestamp}.json`;
    const reportFilePath = path.join(__dirname, reportFileName);

    // Calculate summary statistics
    const totalNamesRemoved = cleanedAssociations.reduce(
      (sum, assoc) => sum + (assoc.removedCount || 0),
      0,
    );
    const totalNamesCleaned = cleanedAssociations.reduce(
      (sum, assoc) => sum + (assoc.cleanedCount || 0),
      0,
    );

    const reportData = {
      metadata: {
        timestamp: new Date().toISOString(),
        scriptVersion: '1.0.0',
        totalFound: associationsWithUndefined.length,
        totalUpdated: updated,
        totalProcessed: processed,
        totalFailed: failed,
        totalNamesRemoved: totalNamesRemoved,
        totalNamesCleaned: totalNamesCleaned,
        remainingWithUndefined: remainingCount,
      },
      cleanedAssociations: cleanedAssociations,
    };

    fs.writeFileSync(
      reportFilePath,
      JSON.stringify(reportData, null, 2),
      'utf8',
    );

    logger.log(`Cleanup report created: ${reportFileName}`);

    logger.log('Cleanup completed.');
    logger.log(
      `Summary: Found: ${associationsWithUndefined.length}, Updated: ${updated}, Failed: ${failed}`,
    );

    if (remainingCount > 0) {
      logger.warn(
        `Warning: ${remainingCount} associations still have "undefined" in fullNames (exact or substring). You may need to run this script again.`,
      );
    } else {
      logger.log(
        'Verification: No associations with "undefined" in fullNames remain (exact or substring).',
      );
    }
  } catch (error) {
    logger.error(
      'Error during cleanup:',
      error?.stack ?? String(error),
    );
    throw error;
  } finally {
    await appContext.close();
  }
}

removeUndefinedFromFullNames()
  .then(() => {
    logger.log('Remove undefined from fullNames script finished successfully.');
    process.exit(0);
  })
  .catch((error) => {
    logger.error(
      'Remove undefined from fullNames script failed.',
      error?.stack ?? String(error),
    );
    process.exit(1);
  });
