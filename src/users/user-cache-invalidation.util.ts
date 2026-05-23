import { Logger } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { User } from 'src/schemas/User.schema';
import { getUserCacheInvalidator } from './user-cache.registry';

const logger = new Logger('UserCacheInvalidation');

export function extractUserId(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Types.ObjectId) return String(value);
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

/** Prominent log for testing — every cache invalidation should print this. */
export function logUserCacheInvalidated(
  trigger: string,
  userIds: string[],
  meta?: { keys?: string[]; deleted?: number },
): void {
  const idList = userIds.length ? userIds.join(', ') : '(none)';
  logger.log('========== USER CACHE INVALIDATED ==========');
  logger.log(`Trigger: ${trigger}`);
  logger.log(`User IDs: ${idList}`);
  if (meta?.keys?.length) {
    logger.log(`Redis keys: ${meta.keys.join(', ')}`);
  }
  if (meta?.deleted !== undefined) {
    logger.log(`Redis DEL count: ${meta.deleted}`);
  }
  logger.log('============================================');
}

export async function invalidateUserIds(
  userIds: Array<string | null | undefined>,
  trigger: string,
): Promise<void> {
  const uniqueIds = [
    ...new Set(userIds.map((id) => extractUserId(id)).filter(Boolean)),
  ] as string[];
  if (uniqueIds.length === 0) {
    logger.warn(`User cache invalidation skipped (${trigger}): no user ids`);
    return;
  }

  const invalidator = getUserCacheInvalidator();
  if (!invalidator) {
    logger.warn(
      `User cache invalidation skipped (${trigger}): invalidator not ready`,
    );
    return;
  }

  try {
    await invalidator.invalidate(uniqueIds, trigger);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`User cache invalidation failed (${trigger}): ${message}`);
  }
}

function collectIdsFromFilter(filter: Record<string, unknown>): string[] {
  const ids: string[] = [];
  const directId = extractUserId(filter._id);
  if (directId) ids.push(directId);

  const inClause = filter._id as { $in?: unknown[] } | undefined;
  if (inClause && Array.isArray(inClause.$in)) {
    for (const id of inClause.$in) {
      const parsed = extractUserId(id);
      if (parsed) ids.push(parsed);
    }
  }

  const ninClause = filter._id as { $nin?: unknown[] } | undefined;
  if (ninClause && Array.isArray(ninClause.$nin)) {
    for (const id of ninClause.$nin) {
      const parsed = extractUserId(id);
      if (parsed) ids.push(parsed);
    }
  }

  return ids;
}

/**
 * Mongoose bulkWrite does not run document middleware — resolve affected user ids manually.
 */
export async function collectUserIdsFromBulkOperations(
  userModel: Model<User>,
  operations: Array<Record<string, unknown>>,
): Promise<string[]> {
  const ids = new Set<string>();

  for (const op of operations) {
    const updateOne = op.updateOne as
      | { filter?: Record<string, unknown> }
      | undefined;
    if (updateOne?.filter) {
      collectIdsFromFilter(updateOne.filter).forEach((id) => ids.add(id));
    }

    const updateMany = op.updateMany as
      | { filter?: Record<string, unknown> }
      | undefined;
    if (updateMany?.filter) {
      const filter = updateMany.filter;
      const fromFilter = collectIdsFromFilter(filter);
      if (fromFilter.length > 0) {
        fromFilter.forEach((id) => ids.add(id));
        continue;
      }

      const docs = await userModel.find(filter).select('_id').lean();
      docs.forEach((doc) => {
        const id = extractUserId(doc._id);
        if (id) ids.add(id);
      });
    }

    const replaceOne = op.replaceOne as
      | { filter?: Record<string, unknown> }
      | undefined;
    if (replaceOne?.filter) {
      collectIdsFromFilter(replaceOne.filter).forEach((id) => ids.add(id));
    }
  }

  return [...ids];
}

export async function invalidateAfterBulkWrite(
  userModel: Model<User>,
  operations: Array<Record<string, unknown>>,
  trigger: string,
): Promise<void> {
  if (!operations?.length) return;
  const ids = await collectUserIdsFromBulkOperations(userModel, operations);
  await invalidateUserIds(ids, trigger);
}
