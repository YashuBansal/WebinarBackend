import {
  BadRequestException,
  Controller,
  forwardRef,
  Headers,
  Inject,
  Post,
  Req,
  Body,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import crypto from 'crypto';
import type { Request } from 'express';
import { AddonPurchaseService } from 'src/addon-purchase/addon-purchase.service';
import { RazorpayConfirmAddonDto } from './dto/razorpay-confirm-addon.dto';

@Controller('payments/razorpay')
export class RazorpayWebhookController {
  constructor(
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => AddonPurchaseService))
    private readonly addonPurchaseService: AddonPurchaseService,
  ) {}

  @Post('webhook')
  async webhook(
    @Req() req: Request,
    @Headers('x-razorpay-signature') signature: string,
  ) {
    // We expect `req.body` to be a Buffer (set via express.raw middleware).
    const rawBody = Buffer.isBuffer((req as any).body)
      ? ((req as any).body as Buffer)
      : null;
    if (!rawBody) {
      throw new BadRequestException(
        'Webhook requires raw body (check body-parser configuration)',
      );
    }

    const secret =
      this.configService.get<string>('RAZORPAY_WEBHOOK_SECRET') ||
      this.configService.get<string>('RAZORPAY_KEY_SECRET');
    if (!secret) throw new BadRequestException('Webhook secret not configured');
    if (!signature) throw new BadRequestException('Missing signature header');

    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    if (expected !== signature) {
      throw new BadRequestException('Invalid webhook signature');
    }

    const payload = JSON.parse(rawBody.toString('utf8'));
    const event = payload?.event;

    // We only handle addon-related success events for now.
    // Razorpay commonly sends `payment.captured`.
    if (event === 'payment.captured') {
      const payment = payload?.payload?.payment?.entity;
      const providerOrderId = payment?.order_id;
      const providerPaymentId = payment?.id;
      const notes = payment?.notes || {};
      const purchaseId = notes?.purchaseId;

      if (!providerOrderId || !providerPaymentId) {
        throw new BadRequestException('Malformed payment.captured payload');
      }

      return await this.addonPurchaseService.finalizeRazorpayAddonPurchase({
        providerOrderId,
        providerPaymentId,
        purchaseId,
      });
    }

    // Acknowledge unhandled events so Razorpay doesn’t retry forever.
    return { ok: true, ignored: true, event };
  }

  /**
   * Canonical confirm endpoint (fallback when webhooks aren't reachable).
   * Verifies signature and finalizes the purchase idempotently.
   */
  @Post('confirm-addon')
  async confirmAddon(@Body() body: RazorpayConfirmAddonDto) {
    const signaturePayload = body.razorpay_subscription_id
      ? `${body.razorpay_payment_id}|${body.razorpay_subscription_id}`
      : body.razorpay_order_id
        ? `${body.razorpay_order_id}|${body.razorpay_payment_id}`
        : '';
    if (!signaturePayload) {
      throw new BadRequestException('Missing Razorpay order or subscription id');
    }
    const generatedSignature = crypto
      .createHmac('sha256', this.configService.get('RAZORPAY_KEY_SECRET'))
      .update(signaturePayload)
      .digest('hex');

    if (generatedSignature !== body.razorpay_signature) {
      throw new BadRequestException('Invalid signature');
    }

    return await this.addonPurchaseService.finalizeRazorpayAddonPurchase({
      providerOrderId: body.razorpay_order_id,
      providerRazorpaySubscriptionId: body.razorpay_subscription_id,
      providerPaymentId: body.razorpay_payment_id,
      purchaseId: body.purchaseId,
    });
  }
}
