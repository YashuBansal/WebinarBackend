export interface HealthCheckResult {
  status: 'up' | 'down' | 'degraded';
  timestamp: string;
  version: string;
  checks: {
    [key: string]: {
      status: 'up' | 'down' | 'degraded';
      latency?: number;
      message?: string;
    };
  };
}

export interface CachedHealthResult {
  result: HealthCheckResult;
  cachedAt: number;
}
