import {
  Body,
  Controller,
  forwardRef,
  Headers,
  Inject,
  Logger,
  Post,
  Query,
  Redirect,
  Req,
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
    @Inject(forwardRef(() => SubscriptionService))
    private subscriptionService: SubscriptionService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => AddonPurchaseService))
    private readonly addonPurchaseService: AddonPurchaseService,
  ) {}

  @Post('/checkout')
  async createOrder(
    @Body() body: RazorPayCheckoutPlanDTO,
    @Id() adminId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<any> {
    const { plan, durationType } = body;
    const key =
      typeof idempotencyKey === 'string' && idempotencyKey.trim().length > 0
        ? idempotencyKey.trim()
        : undefined;
    return this.razorpayService.createPlanOrder(plan, durationType, adminId, {
      idempotencyKey: key,
    });
  }

  @Post('/payment-success')
  @Redirect()
  async paymentSuccess(
    @Body() body: any,
    @Query() query: RazorPayUpdatePlanDTO,
  ): Promise<any> {
    const env = this.configService.get('NEST_ENV');
    const frontendProductionUrl = this.configService.get(
      'FRONTEND_MAIN_PRODUCTION',
    );
    const failedUrl =
      env === 'development'
        ? 'http://localhost:5174/failed'
        : `${frontendProductionUrl}/failed`;

    if (!body.razorpay_subscription_id) {
      return { url: failedUrl };
    }
    const signaturePayload = `${body.razorpay_payment_id}|${body.razorpay_subscription_id}`;

    const generatedSignature = crypto
      .createHmac('sha256', this.configService.get('RAZORPAY_KEY_SECRET'))
      .update(signaturePayload)
      .digest('hex');

    if (generatedSignature !== body.razorpay_signature) {
      return { url: failedUrl };
    }

    const planUpdate = await this.subscriptionService.updateClientPlan(
      query.adminId,
      query.planId,
      query.durationType,
      body.razorpay_subscription_id,
      typeof body.razorpay_payment_id === 'string'
        ? body.razorpay_payment_id
        : undefined,
    );
    if (planUpdate) {
      return {
        url:
          env === 'development'
            ? 'http://localhost:5174/plans'
            : `${frontendProductionUrl}/plans`,
      };
    } else {
      return {
        url:
          env === 'development'
            ? 'http://localhost:5174/failed'
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
    const created = await this.addonPurchaseService.createRazorpayPurchaseOrder({
      adminId,
      addonId: addon,
      idempotencyKey,
    });

    return {
      ...created,
      result: created.result,
      order: created.order,
    };
  }

  @Post('addon/payment-success')
  @Redirect()
  async addonSuccess(
    @Body() body: any,
    @Query() query: RazorPayAddOnDTO,
  ): Promise<any> {
    const env = this.configService.get('NEST_ENV');
    const frontendProductionUrl = this.configService.get(
      'FRONTEND_MAIN_PRODUCTION',
    );
    const failedUrl =
      env === 'development'
        ? 'http://localhost:5174/failed'
        : `${frontendProductionUrl}/failed`;

    const signaturePayload = body.razorpay_subscription_id
      ? `${body.razorpay_payment_id}|${body.razorpay_subscription_id}`
      : body.razorpay_order_id
        ? `${body.razorpay_order_id}|${body.razorpay_payment_id}`
        : '';
    if (!signaturePayload) {
      return { url: failedUrl };
    }

    const generatedSignature = crypto
      .createHmac('sha256', this.configService.get('RAZORPAY_KEY_SECRET'))
      .update(signaturePayload)
      .digest('hex');

    if (generatedSignature !== body.razorpay_signature) {
      return { url: failedUrl };
    }

    const finalizeResult =
      await this.addonPurchaseService.finalizeRazorpayAddonPurchase({
        providerOrderId: body.razorpay_order_id,
        providerRazorpaySubscriptionId: body.razorpay_subscription_id,
        providerPaymentId: body.razorpay_payment_id,
        purchaseId: query.purchaseId,
      });

    if (finalizeResult) {
      return {
        url:
          env === 'development'
            ? `http://localhost:5174/addons/${query.adminId}?purchaseId=${finalizeResult.purchaseId}`
            : `${frontendProductionUrl}/addons/${query.adminId}?purchaseId=${finalizeResult.purchaseId}`,
      };
    } else {
      return {
        url:
          env === 'development'
            ? 'http://localhost:5174/failed'
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
    const signaturePayload = body.razorpay_subscription_id
      ? `${body.razorpay_payment_id}|${body.razorpay_subscription_id}`
      : body.razorpay_order_id
        ? `${body.razorpay_order_id}|${body.razorpay_payment_id}`
        : '';
    if (!signaturePayload) {
      return { ok: false, message: 'Missing Razorpay order or subscription id' };
    }
    const generatedSignature = crypto
      .createHmac('sha256', this.configService.get('RAZORPAY_KEY_SECRET'))
      .update(signaturePayload)
      .digest('hex');

    if (generatedSignature !== body.razorpay_signature) {
      return { ok: false, message: 'Invalid signature' };
    }

    return await this.addonPurchaseService.finalizeRazorpayAddonPurchase({
      providerOrderId: body.razorpay_order_id,
      providerRazorpaySubscriptionId: body.razorpay_subscription_id,
      providerPaymentId: body.razorpay_payment_id,
      purchaseId: body.purchaseId,
    });
  }

  @Post('/webhook')
  async handleWebhook(@Body() body: any, @Query() query: any, @Req() req: any) {
    const signature = req.headers['x-razorpay-signature'];
    this.logger.log(
      JSON.stringify({
        scope: 'RazorpayWebhook',
        phase: 'received',
        body: JSON.stringify(body),
      }),
    );
    if (!signature) {
      this.logger.warn(
        JSON.stringify({
          scope: 'RazorpayWebhook',
          outcome: 'ignored',
          reason: 'missing_x_razorpay_signature_header',
        }),
      );
      return { status: 'ignored', reason: 'no signature' };
    }

    try {
      // Razorpay validation requires raw body. For simplicity in this plan,
      // we assume JSON.stringify works if raw body parsing isn't configured.
      // A robust implementation should use a RawBody decorator.
      const generatedSignature = crypto
        .createHmac('sha256', this.configService.get('RAZORPAY_WEBHOOK_SECRET'))
        .update(JSON.stringify(body))
        .digest('hex');

      // Note: In production, consider taking req.rawBody or using express.raw()
      // if generateSignature doesn't match the Razorpay signature exactly.
      if (generatedSignature !== signature) {
        this.logger.warn(
          JSON.stringify({
            scope: 'RazorpayWebhook',
            outcome: 'rejected',
            reason: 'signature_mismatch',
            event: body?.event ?? null,
          }),
        );
        return { status: 'invalid signature' };
      }

      this.logger.log(
        JSON.stringify({
          scope: 'RazorpayWebhook',
          phase: 'verified',
          event: body?.event ?? null,
          hasSubscriptionEntity: Boolean(
            body?.payload?.subscription?.entity,
          ),
          hasPaymentEntity: Boolean(body?.payload?.payment?.entity),
        }),
      );

      if (body.event === 'subscription.charged') {
        const payload = body.payload.subscription.entity;
        const payment = body.payload.payment.entity;

        await this.subscriptionService.handleSubscriptionCharged(
          payload.id, // razorpay_subscription_id
          payload.notes?.adminId, // assuming we pass adminId in notes during subscription creation
          payment,
          payload,
        );

        this.logger.log(
          JSON.stringify({
            scope: 'RazorpayWebhook',
            phase: 'handled',
            event: 'subscription.charged',
            subscriptionId: payload.id,
            paymentId: payment?.id ?? null,
            adminIdFromNotes: payload.notes?.adminId ?? null,
          }),
        );
      } else if (
        body.event === 'subscription.cancelled' ||
        body.event === 'subscription.halted'
      ) {
        const payload = body.payload.subscription.entity;
        const providerStatus =
          body.event === 'subscription.halted' ? 'halted' : 'cancelled';
        await this.subscriptionService.handleSubscriptionCancelled(
          payload.id,
          providerStatus,
        );

        this.logger.log(
          JSON.stringify({
            scope: 'RazorpayWebhook',
            phase: 'handled',
            event: body.event,
            subscriptionId: payload.id,
          }),
        );
      } else {
        this.logger.log(
          JSON.stringify({
            scope: 'RazorpayWebhook',
            phase: 'noop',
            event: body?.event ?? null,
            reason: 'unhandled_event_type',
          }),
        );
      }

      return { status: 'ok' };
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      this.logger.error(
        JSON.stringify({
          scope: 'RazorpayWebhook',
          phase: 'error',
          message: err.message,
          stack: err.stack ?? null,
        }),
      );
      return { status: 'error', message: err.message };
    }
  }
}
