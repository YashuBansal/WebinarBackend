import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { REDIS_CONNECTION } from 'src/redis/redis.module';
import { scopedVersionKey } from './cache-key.util';

type RedisLike = {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    ...args: Array<string | number>
  ): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
};

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly enabled: boolean;

  constructor(
    @Inject(REDIS_CONNECTION) private readonly redis: RedisLike,
    private readonly configService: ConfigService,
  ) {
    const enabledRaw = this.configService.get<string | boolean>('CACHE_ENABLED');
    this.enabled =
      enabledRaw === false || enabledRaw === 'false' || enabledRaw === '0'
        ? false
        : true;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async getJson<T>(key: string): Promise<T | null> {
    if (!this.enabled || !key) {
      return null;
    }

    try {
      const raw = await this.redis.get(key);
      if (raw === null) {
        return null;
      }
      return JSON.parse(raw) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Cache get failed for key ${key}: ${message}`);
      return null;
    }
  }

  async setJson<T>(
    key: string,
    value: T,
    ttlSeconds?: number,
  ): Promise<void> {
    if (!this.enabled || !key) {
      return;
    }

    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds && ttlSeconds > 0) {
        await this.redis.set(key, serialized, 'EX', ttlSeconds);
      } else {
        await this.redis.set(key, serialized);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Cache set failed for key ${key}: ${message}`);
    }
  }

  async getOrSetJson<T>(
    key: string,
    loader: () => Promise<T>,
    ttlSeconds: number,
  ): Promise<T> {
    const cached = await this.getJson<T>(key);
    if (cached !== null) {
      return cached;
    }

    const value = await loader();
    await this.setJson(key, value, ttlSeconds);
    return value;
  }

  async getRaw(key: string): Promise<string | null> {
    if (!this.enabled || !key) {
      return null;
    }

    try {
      return await this.redis.get(key);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Cache getRaw failed for key ${key}: ${message}`);
      return null;
    }
  }

  async setRaw(
    key: string,
    value: string,
    ttlSeconds?: number,
  ): Promise<void> {
    if (!this.enabled || !key) {
      return;
    }

    try {
      if (ttlSeconds && ttlSeconds > 0) {
        await this.redis.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.redis.set(key, value);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Cache setRaw failed for key ${key}: ${message}`);
    }
  }

  async del(...keys: string[]): Promise<number> {
    if (!this.enabled || keys.length === 0) {
      return 0;
    }

    try {
      return await this.redis.del(...keys);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Cache del failed: ${message}`);
      return 0;
    }
  }

  async incr(key: string): Promise<number> {
    if (!this.enabled || !key) {
      return 0;
    }

    try {
      return await this.redis.incr(key);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Cache incr failed for key ${key}: ${message}`);
      return 0;
    }
  }

  async getScopedVersion(namespace: string, scopeId: string): Promise<string> {
    if (!namespace || !scopeId) {
      return '0';
    }

    const raw = await this.getRaw(scopedVersionKey(namespace, scopeId));
    return raw ?? '0';
  }

  async bumpScopedVersion(
    namespace: string,
    scopeId: string,
    trigger = 'mutation',
  ): Promise<number> {
    if (!this.enabled || !namespace || !scopeId) {
      return 0;
    }

    const key = scopedVersionKey(namespace, scopeId);
    const newVersion = await this.incr(key);
    this.logger.debug(
      `Cache version bumped: namespace=${namespace} scopeId=${scopeId} trigger=${trigger} ver=${newVersion}`,
    );
    return newVersion;
  }
}
