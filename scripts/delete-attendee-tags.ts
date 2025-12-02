import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Document, Model } from 'mongoose';

import { AppModule } from '../src/app.module';
import { Attendee } from '../src/schemas/Attendee.schema';

type AttendeeDocument = Attendee & Document;

const logger = new Logger('DeleteAttendeeTags');

async function deleteTags() {
  const appContext = await NestFactory.createApplicationContext(AppModule);

  try {
    const attendeeModel = appContext.get<Model<AttendeeDocument>>(
      getModelToken(Attendee.name),
    );

    // Count attendees with tags field
    const totalWithTags = await attendeeModel.countDocuments({
      tags: { $exists: true },
    });

    logger.log(`Found ${totalWithTags} attendees with tags field to process.`);

    if (totalWithTags === 0) {
      logger.log('No attendees with tags field found. Nothing to delete.');
      return;
    }

    let processed = 0;
    let deleted = 0;
    let failed = 0;
    const batchSize = 1000;

    // Process in batches for better progress tracking
    while (processed < totalWithTags) {
      try {
        const result = await attendeeModel.updateMany(
          {
            tags: { $exists: true },
          },
          {
            $unset: { tags: '' },
          },
          {
            limit: batchSize,
          },
        );

        deleted += result.modifiedCount;
        processed += result.matchedCount;

        logger.log(
          `Processed ${processed}/${totalWithTags} attendees. Deleted tags from ${deleted} documents.`,
        );

        // If no documents were modified, break to avoid infinite loop
        if (result.modifiedCount === 0) {
          break;
        }
      } catch (error) {
        failed += 1;
        logger.error(
          `Failed to delete tags in batch: ${error?.message ?? String(error)}`,
          error?.stack,
        );
        // Continue with next batch even if one fails
        break;
      }
    }

    // Verify deletion
    const remainingWithTags = await attendeeModel.countDocuments({
      tags: { $exists: true },
    });

    logger.log('Attendee tags deletion completed.');
    logger.log(
      `Total with tags: ${totalWithTags}, Deleted: ${deleted}, Remaining: ${remainingWithTags}, Failed batches: ${failed}`,
    );

    if (remainingWithTags > 0) {
      logger.warn(
        `Warning: ${remainingWithTags} attendees still have tags field. You may need to run this script again.`,
      );
    }
  } catch (error) {
    logger.error(
      'Error during tags deletion:',
      error?.stack ?? String(error),
    );
    throw error;
  } finally {
    await appContext.close();
  }
}

deleteTags()
  .then(() => {
    logger.log('Delete tags script finished successfully.');
    process.exit(0);
  })
  .catch((error) => {
    logger.error(
      'Delete tags script failed.',
      error?.stack ?? String(error),
    );
    process.exit(1);
  });

