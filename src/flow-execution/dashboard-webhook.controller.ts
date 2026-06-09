import { 
  Controller, 
  Post, 
  Param, 
  Body, 
  Logger, 
  HttpCode, 
  HttpStatus, 
  Req, 
  UnauthorizedException,
  HttpException
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Request } from 'express';
import * as crypto from 'crypto';

@Controller('webhooks')
export class DashboardWebhookController {
  private readonly logger = new Logger(DashboardWebhookController.name);

  // Simple in-memory rate limiter to prevent spam (max 60 requests per minute per project/IP)
  private readonly rateLimits = new Map<string, { count: number; resetTime: number }>();

  constructor(private readonly eventEmitter: EventEmitter2) { }

  private checkRateLimit(key: string) {
    const now = Date.now();
    const limitInfo = this.rateLimits.get(key);

    if (!limitInfo || now > limitInfo.resetTime) {
      this.rateLimits.set(key, { count: 1, resetTime: now + 60000 });
      return;
    }

    if (limitInfo.count >= 60) {
      throw new HttpException('Too Many Requests: Webhook rate limit exceeded (max 60 req/min)', HttpStatus.TOO_MANY_REQUESTS);
    }

    limitInfo.count++;
  }

  @Post('catch/:projectId/:triggerNodeId')
  @HttpCode(HttpStatus.OK)
  async catchWebhook(
    @Param('projectId') projectId: string,
    @Param('triggerNodeId') triggerNodeId: string,
    @Body() payload: any,
    @Req() req: Request,
  ) {
    // 1. Rate Limiting Protection (DDoS and spam execution prevention)
    const rateLimitKey = `${projectId}_${req.ip}`;
    this.checkRateLimit(rateLimitKey);

    // 2. Webhook Signature Verification
    const signature = req.headers['x-webhook-signature'] || req.headers['x-razorpay-signature'];
    const secret = process.env.WEBHOOK_SIGNING_SECRET;

    if (secret) {
      if (!signature) {
        this.logger.warn(`Rejected unauthorized webhook: Missing signature header for project ${projectId}`);
        throw new UnauthorizedException('Missing signature header');
      }

      const payloadString = JSON.stringify(payload);
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(payloadString)
        .digest('hex');

      // Secure comparison of signature
      if (signature !== expectedSignature) {
        this.logger.warn(`Rejected unauthorized webhook: Signature verification failed for project ${projectId}`);
        throw new UnauthorizedException('Invalid webhook signature');
      }
    }

    this.logger.log(`Received secure webhook post for project: ${projectId}`);

    try {
      // Emit the internal automation trigger event
      this.eventEmitter.emit('automation.trigger', {
        eventType: 'webhook', // Matches trigger type from frontend
        projectId: projectId,
        data: payload,
        triggerNodeId: triggerNodeId,
      });

      return {
        success: true,
        message: 'Webhook payload received and queued for automation traversal',
      };
    } catch (error) {
      this.logger.error(
        `Failed to process webhook for project ${projectId}:`,
        error instanceof Error ? error.stack : error,
      );
      return {
        success: false,
        message: 'Failed to process webhook payload',
      };
    }
  }
}
