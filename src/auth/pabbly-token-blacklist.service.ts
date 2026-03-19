import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ApiAccessTokenService } from 'src/api-access-token/api-access-token.service';
import { REDIS_CONNECTION } from 'src/redis/redis.module';
import { createHash } from 'crypto';

type RedisLike = {
  exists(key: string): Promise<number>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<any>;
};

@Injectable()
export class PabblyTokenBlacklistService implements OnModuleInit {
  private readonly logger = new Logger(PabblyTokenBlacklistService.name);

  constructor(
    @Inject(REDIS_CONNECTION) private readonly redis: RedisLike,
    private readonly apiTokenService: ApiAccessTokenService,
  ) {}

  async onModuleInit() {
    await this.syncExpiredFromDbOnBoot();
  }

  async isBlacklisted(token: string): Promise<boolean> {
    if (!token) return false;
    const key = this.getRedisKey(token);
    const exists = await this.redis.exists(key);
    return exists === 1;
  }

  async blacklistToken(
    token: string,
    tokenExpiry?: Date | string | null,
  ): Promise<void> {
    if (!token) return;

    const key = this.getRedisKey(token);
    const ttlSeconds = this.getTtlSeconds(tokenExpiry);

    if (ttlSeconds && ttlSeconds > 0) {
      await this.redis.set(key, '1', 'EX', ttlSeconds);
      return;
    }

    // If no expiry (or already past), keep as persistent blacklist entry.
    await this.redis.set(key, '1');
  }

  async syncExpiredFromDbOnBoot(): Promise<void> {
    try {
      const tokens = await this.apiTokenService.fetchExpiredTokens();
      if (!Array.isArray(tokens) || tokens.length === 0) return;

      await Promise.all(
        tokens.map((t: any) => this.blacklistToken(t?.token, t?.tokenExpiry)),
      );

      this.logger.log(`Synced ${tokens.length} expired Pabbly tokens to Redis`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed syncing expired tokens to Redis: ${message}`);
    }
  }

  private getRedisKey(token: string): string {
    const hash = createHash('sha256').update(token).digest('hex');
    return `pabbly:expired:${hash}`;
  }

  private getTtlSeconds(tokenExpiry?: Date | string | null): number | null {
    if (!tokenExpiry) return null;

    const expiryDate =
      tokenExpiry instanceof Date ? tokenExpiry : new Date(tokenExpiry);
    if (Number.isNaN(expiryDate.getTime())) return null;

    const diffMs = expiryDate.getTime() - Date.now();
    const ttlSeconds = Math.ceil(diffMs / 1000);
    return ttlSeconds > 0 ? ttlSeconds : null;
  }
}

