import { createHash } from 'crypto';

export function buildKey(...parts: string[]): string {
  return parts.filter(Boolean).join(':');
}

export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashStableObject(value: unknown, length = 16): string {
  return createHash('sha256')
    .update(stableStringify(value))
    .digest('hex')
    .slice(0, length);
}

export function scopedVersionKey(namespace: string, scopeId: string): string {
  return buildKey(namespace, 'ver', 'v1', scopeId);
}
