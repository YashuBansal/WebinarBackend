import {
  BadRequestException,
  Controller,
  forwardRef,
  Inject,
  Post,
  Body,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import crypto from 'crypto';
import { AddonPurchaseService } from 'src/addon-purchase/addon-purchase.service';
import { RazorpayConfirmAddonDto } from './dto/razorpay-confirm-addon.dto';

@Controller('payments/razorpay')
export class RazorpayWebhookController {
  constructor(
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => AddonPurchaseService))
    private readonly addonPurchaseService: AddonPurchaseService,
  ) {}

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
