import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Document, Model, Types } from 'mongoose';

import { AppModule } from '../src/app.module';
import { Contact } from '../src/contacts/Contact.schema';

type ContactDocument = Contact & Document;

const logger = new Logger('NormalizeContactTagsByProject');

function normalizeTag(tag: string): string {
  return String(tag).trim().toLowerCase().replace(/\s+/g, '_');
}

function normalizeTags(tags?: string[]): string[] {
  if (!Array.isArray(tags) || tags.length === 0) {
    return [];
  }

  return Array.from(new Set(tags.map((tag) => normalizeTag(tag)).filter(Boolean)));
}

async function normalizeContactTagsByProject(projectIdArg: string) {
  if (!projectIdArg || !Types.ObjectId.isValid(projectIdArg)) {
    throw new Error(
      'Invalid or missing projectId. Usage: ts-node -r tsconfig-paths/register scripts/normalize-contact-tags-by-project.ts <projectId>',
    );
  }

  const projectId = new Types.ObjectId(projectIdArg);
  const appContext = await NestFactory.createApplicationContext(AppModule);

  try {
    const contactModel = appContext.get<Model<ContactDocument>>(
      getModelToken(Contact.name),
    );

    const totalContacts = await contactModel.countDocuments({
      projectId,
      tags: { $exists: true, $ne: [] },
    });

    logger.log(
      `Found ${totalContacts} contacts with tags in project ${projectId.toString()}.`,
    );

    if (totalContacts === 0) {
      logger.log('No contacts with tags found for this project. Nothing to update.');
      return;
    }

    const cursor = contactModel
      .find({
        projectId,
        tags: { $exists: true, $ne: [] },
      })
      .select(['_id', 'tags'])
      .cursor();

    let processed = 0;
    let updated = 0;
    let unchanged = 0;
    let failed = 0;

    for await (const contact of cursor) {
      processed += 1;

      try {
        const currentTags = Array.isArray(contact.tags) ? contact.tags : [];
        const normalized = normalizeTags(currentTags);
        const isChanged =
          currentTags.length !== normalized.length ||
          currentTags.some((tag, idx) => tag !== normalized[idx]);

        if (!isChanged) {
          unchanged += 1;
          continue;
        }

        await contactModel.updateOne(
          { _id: contact._id },
          { $set: { tags: normalized } },
        );
        updated += 1;

        if (processed % 200 === 0) {
          logger.log(
            `Progress: processed ${processed}/${totalContacts}, updated ${updated}`,
          );
        }
      } catch (error) {
        failed += 1;
        logger.error(
          `Failed for contact ${String(contact._id)}: ${error?.message ?? String(error)}`,
        );
      }
    }

    logger.log('Tag normalization completed.');
    logger.log(
      `Processed: ${processed}, Updated: ${updated}, Unchanged: ${unchanged}, Failed: ${failed}`,
    );
  } finally {
    await appContext.close();
  }
}

const projectIdArg = process.argv[2];

normalizeContactTagsByProject(projectIdArg)
  .then(() => {
    logger.log('Script finished successfully.');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Script failed.', error?.stack ?? String(error));
    process.exit(1);
  });
