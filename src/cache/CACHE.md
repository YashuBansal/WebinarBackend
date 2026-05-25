# Caching playbook (Redis)

Shared infrastructure: [`CacheService`](./cache.service.ts) via global [`CacheModule`](./cache.module.ts).

Domain-specific rules live in thin facades (e.g. `UserCacheService`, `WebinarListCacheService`).

## When to cache

- Same read path is called often (lists, entity-by-id, dashboards).
- Short staleness is acceptable, or you have explicit invalidation.
- Mongo query is expensive (aggregation, filters, joins) and results are already shaped for the API.

## When not to cache

- Writes and transactional flows where consistency is critical.
- No clear invalidation story (which mutations bust which keys).
- Rarely used endpoints where Redis overhead is not worth it.

## Pattern for new features

1. Add a thin `*CacheService` in the domain module (keys, TTL, invalidation only).
2. Use `CacheService` for all Redis I/O — do not inject `REDIS_CONNECTION` in domain code.
3. Use `buildKey` / `hashStableObject` from [`cache-key.util.ts`](./cache-key.util.ts).
4. On cache failure, return `null` and let the caller load from Mongo (never throw from cache layer).

## Key naming

```
{domain}:{resource}:v{N}:{scopeId}:{optionalHash}
```

Examples:

- `user:by-id:v1:{userId}`
- `webinar:list:ver:v1:{adminId}` (version counter)
- `webinar:list:v1:{adminId}:{version}:{queryHash}` (payload)

## Invalidation strategies

| Strategy | Use when | API |
|----------|----------|-----|
| **Delete keys** | Low cardinality (one key per entity) | `cache.del(...keys)` |
| **Version bump** | High cardinality (many list query permutations) | `cache.bumpScopedVersion(namespace, scopeId)` |

After a version bump, old payload keys expire via TTL; new reads use the new version number.

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `CACHE_ENABLED` | `true` | Global kill switch |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis connection (see `src/redis/redis.module.ts`) |
| `USER_CACHE_TTL_SECONDS` | `86400` | User-by-id cache TTL |
| `USER_CACHE_NOT_FOUND_TTL_SECONDS` | `60` | Negative cache for missing users |
| `WEBINAR_LIST_CACHE_ENABLED` | `true` | Webinar list feature flag |
| `WEBINAR_LIST_CACHE_TTL_SECONDS` | `120` | Webinar list response TTL |

## Existing facades

- **Users:** `src/users/user-cache.service.ts` — direct key delete on user mutations.
- **Webinar list:** `src/webinar/webinar-list-cache.service.ts` — version bump on webinar/attendee stat changes.
