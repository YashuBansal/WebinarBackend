import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { HealthService } from './health.service';
import { HealthCheckResult } from './interfaces/health-check.interface';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /**
   * Liveness Probe
   * GET /api/v1/health/live
   * Returns 200 OK if the process is running
   */
  @Get('live')
  @HttpCode(HttpStatus.OK)
  async liveness() {
    return await this.healthService.checkLiveness();
  }

  /**
   * Startup Probe
   * GET /api/v1/health/startup
   * Returns 200 OK if application initialization is complete
   */
  @Get('startup')
  async startup(@Res() res: Response) {
    const result = await this.healthService.checkStartup();
    const statusCode =
      result.status === 'up' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;
    return res.status(statusCode).json(this.sanitizeResponse(result));
  }

  /**
   * Readiness Probe
   * GET /api/v1/health/ready
   * Returns comprehensive health status
   * Query params:
   *   - skipCache: boolean (default: false) - bypass cache for fresh check
   */
  @Get('ready')
  async readiness(
    @Query('skipCache') skipCache?: string,
    @Res() res?: Response,
  ) {
    const useCache = skipCache !== 'true';
    const result = await this.healthService.checkReadiness(useCache);

    // Determine HTTP status code
    const statusCode =
      result.status === 'down'
        ? HttpStatus.SERVICE_UNAVAILABLE
        : HttpStatus.OK;

    const sanitized = this.sanitizeResponse(result);
    
    if (res) {
      res.status(statusCode).json(sanitized);
      return;
    }
    
    // This shouldn't happen, but handle gracefully
    return sanitized;
  }

  /**
   * Combined health check endpoint (optional)
   * GET /api/v1/health
   * Returns readiness check by default
   */
  @Get()
  async health(
    @Query('skipCache') skipCache?: string,
    @Res() res?: Response,
  ) {
    return this.readiness(skipCache, res);
  }

  /**
   * Sanitize response to remove sensitive information
   */
  private sanitizeResponse(result: HealthCheckResult): HealthCheckResult {
    // Create a sanitized copy
    const sanitized: HealthCheckResult = {
      ...result,
      checks: {},
    };

    // Copy checks but remove any stack traces or sensitive error details
    for (const [key, check] of Object.entries(result.checks)) {
      sanitized.checks[key] = {
        status: check.status,
        latency: check.latency,
        message: check.message
          ? this.sanitizeMessage(check.message)
          : undefined,
      };
    }

    return sanitized;
  }

  /**
   * Remove stack traces and sensitive information from error messages
   */
  private sanitizeMessage(message: string): string {
    // Remove stack traces
    if (message.includes('at ')) {
      return message.split('\n')[0];
    }
    // Return generic message for sensitive errors
    if (message.toLowerCase().includes('password') ||
        message.toLowerCase().includes('secret') ||
        message.toLowerCase().includes('key')) {
      return 'Configuration error';
    }
    return message;
  }
}

