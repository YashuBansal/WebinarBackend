import {
  Body,
  Controller,
  Logger,
  Post,
  Query,
  Redirect,
} from '@nestjs/common';
import { RazorpayService } from './razorpay.service';
import { SubscriptionService } from 'src/subscription/subscription.service';
import {
  RazorPayAddOnDTO,
  RazorPayCheckoutPlanDTO,
  RazorPayConfirmAddonDTO,
  RazorPayUpdatePlanDTO,
} from './dto/razorpay.dto';
import { ConfigService } from '@nestjs/config';
import crypto from 'crypto';
import { Id } from 'src/decorators/custom.decorator';
import { AddonPurchaseService } from 'src/addon-purchase/addon-purchase.service';
@Controller('razorpay')
export class RazorpayController {
  private readonly logger = new Logger(RazorpayController.name);
  constructor(
    private razorpayService: RazorpayService,
    private subscriptionService: SubscriptionService,
    private readonly configService: ConfigService,
    private readonly addonPurchaseService: AddonPurchaseService,
  ) {}

  @Post('/checkout')
  async createOrder(
    @Body() body: RazorPayCheckoutPlanDTO,
    @Id() adminId: string,
  ): Promise<any> {
    const { plan, durationType } = body;
    return this.razorpayService.createPlanOrder(plan, durationType, adminId);
  }

  @Post('/payment-success')
  @Redirect()
  async paymentSuccess(
    @Body() body: any,
    @Query() query: RazorPayUpdatePlanDTO,
  ): Promise<any> {
    //validate payment success here

    const generatedSignature = crypto
      .createHmac('sha256', this.configService.get('RAZORPAY_KEY_SECRET'))
      .update(`${body.razorpay_order_id}|${body.razorpay_payment_id}`)
      .digest('hex');

    if (generatedSignature !== body.razorpay_signature) {
      return { url: 'http://localhost:5173/failed' };
    }

    const planUpdate = await this.subscriptionService.updateClientPlan(
      query.adminId,
      query.planId,
      query.durationType,
    );
    const env = this.configService.get('NEST_ENV');
    const frontendProductionUrl = this.configService.get(
      'FRONTEND_MAIN_PRODUCTION',
    );

    if (planUpdate) {
      return {
        url:
          env === 'development'
            ? 'http://localhost:5173/plans'
            : `${frontendProductionUrl}/plans`,
      };
    } else {
      return {
        url:
          env === 'development'
            ? 'http://localhost:5173/failed'
            : `${frontendProductionUrl}/failed`,
      };
    }
  }

  @Post('/addon/checkout')
  async createAddonOrder(
    @Body('addon') addon: string,
    @Id() adminId: string,
  ): Promise<any> {
    // Deprecated endpoint: kept as alias for backwards compatibility.
    this.logger.warn('DeprecatedEndpointUsed: POST /razorpay/addon/checkout');

    // Create purchase-ledger order under the hood.
    const idempotencyKey = crypto.randomUUID();
    const {
      purchase,
      order,
      addon: addonData,
    } = await this.addonPurchaseService.createRazorpayPurchaseOrder({
      adminId,
      addonId: addon,
      idempotencyKey,
    });

    // Backward-compatible response shape for older clients + include canonical fields.
    return {
      purchase,
      order,
      addon: addonData,
      addonData,
      result: order,
    };
  }

  @Post('addon/payment-success')
  @Redirect()
  async addonSuccess(
    @Body() body: any,
    @Query() query: RazorPayAddOnDTO,
  ): Promise<any> {
    // Deprecated endpoint: kept as alias for backwards compatibility.
    this.logger.warn(
      'DeprecatedEndpointUsed: POST /razorpay/addon/payment-success',
    );

    const generatedSignature = crypto
      .createHmac('sha256', this.configService.get('RAZORPAY_KEY_SECRET'))
      .update(`${body.razorpay_order_id}|${body.razorpay_payment_id}`)
      .digest('hex');

    if (generatedSignature !== body.razorpay_signature) {
      return { url: 'http://localhost:5173/failed' };
    }

    const finalizeResult =
      await this.addonPurchaseService.finalizeRazorpayAddonPurchase({
        providerOrderId: body.razorpay_order_id,
        providerPaymentId: body.razorpay_payment_id,
      });

    const env = this.configService.get('NEST_ENV');
    const frontendProductionUrl = this.configService.get(
      'FRONTEND_MAIN_PRODUCTION',
    );
    if (finalizeResult) {
      return {
        url:
          env === 'development'
            ? `http://localhost:5173/addons/${query.adminId}?purchaseId=${finalizeResult.purchaseId}`
            : `${frontendProductionUrl}/addons/${query.adminId}?purchaseId=${finalizeResult.purchaseId}`,
      };
    } else {
      return {
        url:
          env === 'development'
            ? 'http://localhost:5173/failed'
            : `${frontendProductionUrl}/failed`,
      };
    }
  }

  /**
   * Fallback for environments where webhooks aren't reachable.
   * Confirms signature and finalizes the purchase immediately.
   */
  @Post('addon/confirm')
  async confirmAddonPayment(@Body() body: RazorPayConfirmAddonDTO) {
    // Alias route for backwards compatibility; canonical route is
    // POST /payments/razorpay/confirm-addon
    const generatedSignature = crypto
      .createHmac('sha256', this.configService.get('RAZORPAY_KEY_SECRET'))
      .update(`${body.razorpay_order_id}|${body.razorpay_payment_id}`)
      .digest('hex');

    if (generatedSignature !== body.razorpay_signature) {
      return { ok: false, message: 'Invalid signature' };
    }

    return await this.addonPurchaseService.finalizeRazorpayAddonPurchase({
      providerOrderId: body.razorpay_order_id,
      providerPaymentId: body.razorpay_payment_id,
      purchaseId: body.purchaseId,
    });
  }
}
