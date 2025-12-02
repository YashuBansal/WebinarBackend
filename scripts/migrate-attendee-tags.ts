import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Document, Model, Types } from 'mongoose';

import { AppModule } from '../src/app.module';
import { Attendee } from '../src/schemas/Attendee.schema';
import { AttendeeAssociation } from '../src/schemas/attendee-association.schema';

type AttendeeDocument = Attendee & Document;
type AttendeeAssociationDocument = AttendeeAssociation & Document;

const logger = new Logger('AttendeeTagMigration');

function normalizeTags(tags?: string[]): string[] {
  if (!Array.isArray(tags) || tags.length === 0) {
    return [];
  }

  return Array.from(
    new Set(
      tags
        .map((tag) =>
          (tag ?? '')
            .toString()
            .toLowerCase()
            .replace(/\s+/g, '')
            .trim(),
        )
        .filter((tag) => Boolean(tag)),
    ),
  );
}

async function migrateTags() {
  const appContext = await NestFactory.createApplicationContext(AppModule);

  try {
    const attendeeModel = appContext.get<Model<AttendeeDocument>>(
      getModelToken(Attendee.name),
    );
    const associationModel = appContext.get<Model<AttendeeAssociationDocument>>(
      getModelToken(AttendeeAssociation.name),
    );

    const cursor = attendeeModel
      .find({
        tags: { $exists: true, $ne: [] },
        email: { $exists: true, $ne: null },
        adminId: { $exists: true, $ne: null },
      })
      .select(['adminId', 'email', 'tags'])
      .cursor();

    let processed = 0;
    let migrated = 0;
    let skipped = 0;
    let failed = 0;

    for await (const attendee of cursor) {
      processed += 1;
      const adminId = attendee.adminId as Types.ObjectId;
      const email = (attendee.email || '').toLowerCase().trim();
      // const normalizedTags = normalizeTags(attendee.tags);
      const normalizedTags = [];

      if (!adminId || !email || normalizedTags.length === 0) {
        skipped += 1;
        continue;
      }

      try {
        await associationModel.updateOne(
          { adminId, email },
          {
            $setOnInsert: {
              fullNames: [],
              phones: [],
            },
            $addToSet: {
              tags: { $each: normalizedTags },
            },
          },
          { upsert: true },
        );

        migrated += 1;

        if (migrated % 100 === 0) {
          logger.log(`Migrated tags for ${migrated} attendees so far...`);
        }
      } catch (error) {
        failed += 1;
        logger.error(
          `Failed to migrate tags for attendee ${email} (admin: ${adminId?.toString()})`,
          error?.stack ?? String(error),
        );
      }
    }

    logger.log('Attendee tag migration completed.');
    logger.log(
      `Processed: ${processed}, Migrated: ${migrated}, Skipped: ${skipped}, Failed: ${failed}`,
    );
  } finally {
    await appContext.close();
  }
}

migrateTags()
  .then(() => {
    logger.log('Migration script finished successfully.');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Migration script failed.', error?.stack ?? String(error));
    process.exit(1);
  });

