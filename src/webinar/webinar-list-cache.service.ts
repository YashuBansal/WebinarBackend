import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from 'src/cache/cache.service';
import { buildKey, hashStableObject } from 'src/cache/cache-key.util';
import { WebinarFilterDTO } from './dto/webinar-filter.dto';

const LIST_NAMESPACE = 'webinar:list';

export type WebinarListCachePayload = {
  result: unknown[];
  pagination: {
    totalPages: number;
    page: number;
    total: number;
    limit: number;
  };
};

@Injectable()
export class WebinarListCacheService {
  private readonly logger = new Logger(WebinarListCacheService.name);
  private readonly featureEnabled: boolean;
  private readonly ttlSeconds: number;

  constructor(
    private readonly cacheService: CacheService,
    private readonly configService: ConfigService,
  ) {
    const enabledRaw = this.configService.get<string | boolean>(
      'WEBINAR_LIST_CACHE_ENABLED',
    );
    this.featureEnabled =
      enabledRaw === false ||
      enabledRaw === 'false' ||
      enabledRaw === '0'
        ? false
        : true;
    this.ttlSeconds =
      Number(this.configService.get<number>('WEBINAR_LIST_CACHE_TTL_SECONDS')) ||
      120;
  }

  private isActive(): boolean {
    return this.cacheService.isEnabled() && this.featureEnabled;
  }

  async get(
    adminId: string,
    page: number,
    limit: number,
    filters: WebinarFilterDTO = {},
  ): Promise<WebinarListCachePayload | null> {
    if (!this.isActive() || !adminId) {
      return null;
    }

    const version = await this.cacheService.getScopedVersion(
      LIST_NAMESPACE,
      adminId,
    );
    const key = this.buildPayloadKey(adminId, version, page, limit, filters);
    const parsed = await this.cacheService.getJson<WebinarListCachePayload>(key);

    if (parsed === null) {
      this.logger.debug(
        `getWebinars: adminId=${adminId} source=mongodb (cache miss) page=${page}`,
      );
      return null;
    }

    this.logger.log(
      `getWebinars: adminId=${adminId} source=redis (cache hit) page=${page} limit=${limit}`,
    );
    return parsed;
  }

  async set(
    adminId: string,
    page: number,
    limit: number,
    filters: WebinarFilterDTO,
    payload: WebinarListCachePayload,
  ): Promise<void> {
    if (!this.isActive() || !adminId) {
      return;
    }

    const version = await this.cacheService.getScopedVersion(
      LIST_NAMESPACE,
      adminId,
    );
    const key = this.buildPayloadKey(adminId, version, page, limit, filters);
    await this.cacheService.setJson(key, payload, this.ttlSeconds);
    this.logger.debug(
      `getWebinars: adminId=${adminId} cached page=${page} limit=${limit} ver=${version}`,
    );
  }

  async bumpVersion(adminId: string, trigger = 'mutation'): Promise<void> {
    if (!this.isActive() || !adminId) {
      return;
    }

    await this.cacheService.bumpScopedVersion(
      LIST_NAMESPACE,
      adminId,
      trigger,
    );
  }

  private buildPayloadKey(
    adminId: string,
    version: string,
    page: number,
    limit: number,
    filters: WebinarFilterDTO,
  ): string {
    const hash = hashStableObject({ page, limit, filters: filters ?? {} });
    return buildKey('webinar', 'list', 'v1', adminId, version, hash);
  }
}
