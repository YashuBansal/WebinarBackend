import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { HealthCheckResult, CachedHealthResult } from './interfaces/health-check.interface';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly cache: Map<string, CachedHealthResult> = new Map();
  private readonly CACHE_TTL = 12000; // 12 seconds (between 10-15 as requested)
  private readonly CHECK_TIMEOUT = 2000; // 2 seconds per check
  private appVersion: string = 'unknown';
  private isStartupComplete = false;

  constructor(
    @InjectConnection() private readonly mongooseConnection: Connection,
    private readonly configService: ConfigService,
  ) {
    this.loadAppVersion();
    // Mark startup as complete after a short delay to allow app initialization
    setTimeout(() => {
      this.isStartupComplete = true;
      this.logger.log('Application startup marked as complete');
    }, 5000);
  }

  private loadAppVersion(): void {
    try {
      const packageJsonPath = path.join(process.cwd(), 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        this.appVersion = packageJson.version || process.env.APP_VERSION || 'unknown';
      } else {
        this.appVersion = process.env.APP_VERSION || 'unknown';
      }
    } catch (error) {
      this.logger.warn('Failed to load app version from package.json', error);
      this.appVersion = process.env.APP_VERSION || 'unknown';
    }
  }

  /**
   * Liveness probe - simple check that the process is running
   */
  async checkLiveness(): Promise<{ status: string }> {
    return { status: 'ok' };
  }

  /**
   * Startup probe - checks if application initialization is complete
   */
  async checkStartup(): Promise<HealthCheckResult> {
    const result: HealthCheckResult = {
      status: this.isStartupComplete ? 'up' : 'down',
      timestamp: new Date().toISOString(),
      version: this.appVersion,
      checks: {
        startup: {
          status: this.isStartupComplete ? 'up' : 'down',
          message: this.isStartupComplete
            ? 'Application startup complete'
            : 'Application still initializing',
        },
      },
    };

    return result;
  }

  /**
   * Readiness probe - comprehensive health check
   */
  async checkReadiness(useCache: boolean = true): Promise<HealthCheckResult> {
    const cacheKey = 'readiness';
    
    // Check cache first
    if (useCache) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.cachedAt < this.CACHE_TTL) {
        this.logger.debug('Returning cached health check result');
        return cached.result;
      }
    }

    // Perform health checks
    const checks: HealthCheckResult['checks'] = {};
    const criticalChecks: string[] = ['database'];
    const softDependencies: string[] = ['smtp', 'cloudinary'];

    // Critical checks
    checks.database = await this.checkDatabase();
    
    // Soft dependencies
    checks.smtp = await this.checkSmtp();
    checks.cloudinary = await this.checkCloudinary();

    // Determine overall status
    const criticalDown = criticalChecks.some(
      (key) => checks[key]?.status === 'down',
    );
    const hasDegraded = Object.values(checks).some(
      (check) => check.status === 'degraded',
    );

    let overallStatus: 'up' | 'down' | 'degraded' = 'up';
    if (criticalDown) {
      overallStatus = 'down';
    } else if (hasDegraded) {
      overallStatus = 'degraded';
    }

    const result: HealthCheckResult = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: this.appVersion,
      checks,
    };

    // Cache the result
    this.cache.set(cacheKey, {
      result,
      cachedAt: Date.now(),
    });

    return result;
  }

  /**
   * Check MongoDB database connectivity
   */
  private async checkDatabase(): Promise<{
    status: 'up' | 'down' | 'degraded';
    latency?: number;
    message?: string;
  }> {
    const startTime = Date.now();
    
    try {
      const checkPromise = this.mongooseConnection.db
        .admin()
        .ping()
        .then(() => {
          const latency = Date.now() - startTime;
          return {
            status: 'up' as const,
            latency,
            message: 'Database connection healthy',
          };
        });

      const timeoutPromise = new Promise<{
        status: 'down';
        message: string;
      }>((resolve) => {
        setTimeout(() => {
          resolve({
            status: 'down',
            message: 'Database check timed out',
          });
        }, this.CHECK_TIMEOUT);
      });

      return await Promise.race([checkPromise, timeoutPromise]);
    } catch (error) {
      const latency = Date.now() - startTime;
      this.logger.error('Database health check failed', error);
      return {
        status: 'down',
        latency,
        message: 'Database connection failed',
      };
    }
  }

  /**
   * Check SMTP email service (soft dependency)
   */
  private async checkSmtp(): Promise<{
    status: 'up' | 'down' | 'degraded';
    latency?: number;
    message?: string;
  }> {
    const startTime = Date.now();
    
    try {
      // Check if SMTP configuration exists
      const smtpHost = this.configService.get<string>('MAILDEV_INCOMING_USER');
      if (!smtpHost) {
        return {
          status: 'degraded',
          message: 'SMTP not configured',
        };
      }

      // For SMTP, we'll just verify the transport is configured
      // Actual connection test would require sending a test email
      // which we don't want to do on every health check
      const latency = Date.now() - startTime;
      
      return {
        status: 'up',
        latency,
        message: 'SMTP configuration present',
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      this.logger.warn('SMTP health check failed', error);
      return {
        status: 'degraded',
        latency,
        message: 'SMTP check failed',
      };
    }
  }

  /**
   * Check Cloudinary service (soft dependency)
   */
  private async checkCloudinary(): Promise<{
    status: 'up' | 'down' | 'degraded';
    latency?: number;
    message?: string;
  }> {
    const startTime = Date.now();
    
    try {
      const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
      const apiKey = process.env.CLOUDINARY_API_KEY;
      const apiSecret = process.env.CLOUDINARY_API_SECRET;

      if (!cloudName || !apiKey || !apiSecret) {
        return {
          status: 'degraded',
          message: 'Cloudinary not configured',
        };
      }

      // Lightweight check - verify configuration is loaded
      // Full API check would require making an actual API call
      const latency = Date.now() - startTime;
      
      return {
        status: 'up',
        latency,
        message: 'Cloudinary configuration present',
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      this.logger.warn('Cloudinary health check failed', error);
      return {
        status: 'degraded',
        latency,
        message: 'Cloudinary check failed',
      };
    }
  }

  /**
   * Clear health check cache (useful for testing or manual refresh)
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.log('Health check cache cleared');
  }
}

