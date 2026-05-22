import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { REDIS_CONNECTION } from 'src/redis/redis.module';
import { User } from 'src/schemas/User.schema';
import {
  invalidateAfterBulkWrite,
  logUserCacheInvalidated,
} from './user-cache-invalidation.util';
import { setUserCacheInvalidator } from './user-cache.registry';

const CACHE_KEY_PREFIX = 'user:by-id:v1:';
const MISSING_SENTINEL = '__missing__';

type RedisLike = {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    ...args: Array<string | number>
  ): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
};

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
    @Inject(REDIS_CONNECTION) private readonly redis: RedisLike,
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
    return `${CACHE_KEY_PREFIX}${userId}`;
  }

  async get(
    userId: string,
  ): Promise<CachedUserRecord | null | typeof MISSING_SENTINEL> {
    if (!userId) return MISSING_SENTINEL;

    try {
      const raw = await this.redis.get(this.getKey(userId));
      if (raw === null) return null;
      const parsed = JSON.parse(raw) as { __missing?: boolean } & CachedUserRecord;
      if (parsed?.__missing === true) {
        return MISSING_SENTINEL;
      }
      return parsed as CachedUserRecord;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`User cache get failed for ${userId}: ${message}`);
      return null;
    }
  }

  async set(userId: string, user: CachedUserRecord | null): Promise<void> {
    if (!userId) return;

    try {
      const key = this.getKey(userId);
      if (!user) {
        await this.redis.set(
          key,
          JSON.stringify({ __missing: true }),
          'EX',
          this.notFoundTtlSeconds,
        );
        return;
      }

      await this.redis.set(
        key,
        JSON.stringify(user),
        'EX',
        this.ttlSeconds,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`User cache set failed for ${userId}: ${message}`);
    }
  }

  async invalidate(
    userId: string | string[],
    trigger = 'manual',
  ): Promise<void> {
    const ids = (Array.isArray(userId) ? userId : [userId])
      .map((id) => String(id || '').trim())
      .filter(Boolean);
    if (ids.length === 0) return;

    try {
      const keys = ids.map((id) => this.getKey(id));
      const deleted = await this.redis.del(...keys);
      logUserCacheInvalidated(trigger, ids, { keys, deleted });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `User cache invalidate failed (${trigger}): ${message}`,
      );
    }
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
