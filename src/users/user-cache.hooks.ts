import { Logger } from '@nestjs/common';
import { Schema } from 'mongoose';
import {
  extractUserId,
  invalidateUserIds,
} from './user-cache-invalidation.util';

const logger = new Logger('UserCacheHooks');

type QueryContext = {
  getFilter?: () => Record<string, unknown>;
  getQuery?: () => { _id?: unknown };
  model?: {
    find: (filter: unknown) => {
      select: (s: string) => { lean: () => Promise<Array<{ _id: unknown }>> };
    };
  };
};

async function invalidateFromFilter(
  filter: Record<string, unknown>,
  trigger: string,
  model?: QueryContext['model'],
): Promise<void> {
  const directId = extractUserId(filter._id);
  if (directId) {
    await invalidateUserIds([directId], trigger);
    return;
  }

  const inClause = filter._id as { $in?: unknown[] } | undefined;
  if (inClause && Array.isArray(inClause.$in)) {
    await invalidateUserIds(
      inClause.$in.map((id) => extractUserId(id)),
      trigger,
    );
    return;
  }

  if (!model) {
    logger.warn(`${trigger}: cannot resolve user ids from filter`);
    return;
  }

  try {
    const docs = await model.find(filter).select('_id').lean();
    await invalidateUserIds(
      docs.map((d) => extractUserId(d._id)),
      trigger,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`${trigger}: filter lookup failed: ${message}`);
  }
}

export function registerUserCacheHooks(schema: Schema): void {
  schema.post('save', function (doc: { _id?: unknown }) {
    void invalidateUserIds([extractUserId(doc?._id)], 'mongoose:save');
  });

  schema.post('findOneAndUpdate', function (doc: { _id?: unknown } | null) {
    const ctx = this as QueryContext;
    const filterId = extractUserId(ctx.getQuery?.()?._id);
    void invalidateUserIds(
      [extractUserId(doc?._id), filterId],
      'mongoose:findOneAndUpdate',
    );
  });

  schema.post('updateOne', async function () {
    const ctx = this as QueryContext;
    await invalidateFromFilter(
      ctx.getFilter?.() ?? {},
      'mongoose:updateOne',
      ctx.model,
    );
  });

  schema.post('updateMany', async function () {
    const ctx = this as QueryContext;
    await invalidateFromFilter(
      ctx.getFilter?.() ?? {},
      'mongoose:updateMany',
      ctx.model,
    );
  });

  schema.post('deleteOne', async function () {
    const ctx = this as QueryContext;
    await invalidateFromFilter(
      ctx.getFilter?.() ?? {},
      'mongoose:deleteOne',
      ctx.model,
    );
  });

  schema.post('deleteMany', async function () {
    const ctx = this as QueryContext;
    await invalidateFromFilter(
      ctx.getFilter?.() ?? {},
      'mongoose:deleteMany',
      ctx.model,
    );
  });

  schema.post('findOneAndDelete', function (doc: { _id?: unknown } | null) {
    const ctx = this as QueryContext;
    const filterId = extractUserId(ctx.getQuery?.()?._id);
    void invalidateUserIds(
      [extractUserId(doc?._id), filterId],
      'mongoose:findOneAndDelete',
    );
  });
}
