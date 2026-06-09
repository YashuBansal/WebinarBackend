import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  Res,
  Req,
  Logger,
  UnauthorizedException,
  HttpException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response, Request } from 'express';
import { WebhookService } from './webhook.service';
import * as crypto from 'crypto';

@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  // In-memory rate limiter to prevent Meta webhooks spam (max 100 requests per minute)
  private readonly rateLimits = new Map<string, { count: number; resetTime: number }>();

  constructor(
    private readonly configService: ConfigService,
    private readonly webhookService: WebhookService,
  ) {}

  private checkRateLimit(ip: string) {
    const now = Date.now();
    const limitInfo = this.rateLimits.get(ip);

    if (!limitInfo || now > limitInfo.resetTime) {
      this.rateLimits.set(ip, { count: 1, resetTime: now + 60000 });
      return;
    }

    if (limitInfo.count >= 100) {
      throw new HttpException('Too Many Requests: WABA Webhook rate limit exceeded (max 100 req/min)', HttpStatus.TOO_MANY_REQUESTS);
    }

    limitInfo.count++;
  }

  /**
   * GET /webhook
   * Handles WhatsApp verification request from Meta Cloud API.
   */
  @Get()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.challenge') challenge: string,
    @Query('hub.verify_token') token: string,
    @Res() res: Response,
  ) {
    const expectedToken = this.configService.get<string>('META_WEBHOOK_VERIFY_TOKEN');

    if (mode === 'subscribe' && token === expectedToken) {
      this.logger.log('Webhook verification successful.');
      // Respond with the challenge token exactly as text
      return res.status(HttpStatus.OK).send(challenge);
    }

    this.logger.warn('Webhook verification failed: Invalid verify_token or mode.');
    throw new ForbiddenException('Webhook verification failed: Invalid mode or token.');
  }

  /**
   * POST /webhook
   * Ingests message events and status updates from Meta Cloud API.
   * Immediately returns 200 OK to prevent Meta retries, then processes payload asynchronously.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  handleWebhookPayload(
    @Body() body: any,
    @Req() req: Request,
  ) {
    // 1. Rate Limiting Protection
    this.checkRateLimit(req.ip);

    // 2. Meta Signature Verification (X-Hub-Signature-256)
    const signature = req.headers['x-hub-signature-256'] as string;
    const appSecret = this.configService.get<string>('META_APP_SECRET') || process.env.META_APP_SECRET;

    if (appSecret && signature) {
      const payloadString = JSON.stringify(body);
      const expectedSignature = 'sha256=' + crypto
        .createHmac('sha256', appSecret)
        .update(payloadString)
        .digest('hex');

      if (signature !== expectedSignature) {
        this.logger.warn('WABA Webhook signature mismatch. Access Denied.');
        throw new UnauthorizedException('Invalid signature');
      }
    }

    // Process asynchronously in background
    this.webhookService.processPayload(body).catch((err) => {
      this.logger.error('Error during asynchronous payload processing:', err);
    });

    // Return immediately to satisfy Meta requirements
    return { status: 'success' };
  }
}
