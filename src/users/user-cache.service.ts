import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CacheService } from 'src/cache/cache.service';
import { buildKey } from 'src/cache/cache-key.util';
import { User } from 'src/schemas/User.schema';
import {
  invalidateAfterBulkWrite,
  logUserCacheInvalidated,
} from './user-cache-invalidation.util';
import { setUserCacheInvalidator } from './user-cache.registry';

const MISSING_SENTINEL = '__missing__';

export type CachedUserRecord = Record<string, unknown> & {
  _id?: unknown;
  isActive?: boolean;
};

@Injectable()
export class UserCacheService implements OnModuleInit {
  private static invalidator: UserCacheService | null = null;
  private readonly logger = new Logger(UserCacheService.name);
  private readonly ttlSeconds: number;
  private readonly notFoundTtlSeconds: number;

  constructor(
    private readonly cacheService: CacheService,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly configService: ConfigService,
  ) {
    this.ttlSeconds =
      this.configService.get<number>('USER_CACHE_TTL_SECONDS') ?? 86400;
    this.notFoundTtlSeconds =
      this.configService.get<number>('USER_CACHE_NOT_FOUND_TTL_SECONDS') ?? 60;
  }

  onModuleInit(): void {
    UserCacheService.invalidator = this;
    setUserCacheInvalidator(this);
    this.logger.log('User cache invalidator ready (hooks on UserSchema at load time)');
  }

  private getKey(userId: string): string {
    return buildKey('user', 'by-id', 'v1', userId);
  }

  async get(
    userId: string,
  ): Promise<CachedUserRecord | null | typeof MISSING_SENTINEL> {
    if (!userId) return MISSING_SENTINEL;

    const parsed = await this.cacheService.getJson<
      { __missing?: boolean } & CachedUserRecord
    >(this.getKey(userId));

    if (parsed === null) {
      return null;
    }

    if (parsed?.__missing === true) {
      return MISSING_SENTINEL;
    }

    return parsed as CachedUserRecord;
  }

  async set(userId: string, user: CachedUserRecord | null): Promise<void> {
    if (!userId) return;

    const key = this.getKey(userId);
    if (!user) {
      await this.cacheService.setJson(
        key,
        { __missing: true },
        this.notFoundTtlSeconds,
      );
      return;
    }

    await this.cacheService.setJson(key, user, this.ttlSeconds);
  }

  async invalidate(
    userId: string | string[],
    trigger = 'manual',
  ): Promise<void> {
    const ids = (Array.isArray(userId) ? userId : [userId])
      .map((id) => String(id || '').trim())
      .filter(Boolean);
    if (ids.length === 0) return;

    const keys = ids.map((id) => this.getKey(id));
    const deleted = await this.cacheService.del(...keys);
    logUserCacheInvalidated(trigger, ids, { keys, deleted });
  }

  async invalidateAfterBulkWrite(
    operations: Array<Record<string, unknown>>,
    trigger: string,
  ): Promise<void> {
    await invalidateAfterBulkWrite(this.userModel, operations, trigger);
  }

  static getMissingSentinel(): typeof MISSING_SENTINEL {
    return MISSING_SENTINEL;
  }
}
