import {
  BadRequestException,
  Body,
  Controller,
  forwardRef,
  Headers,
  HttpCode,
  InternalServerErrorException,
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
  RazorPayPaymentSuccessBodyDTO,
  RazorPayUpdatePlanDTO,
} from './dto/razorpay.dto';
import { ConfigService } from '@nestjs/config';
import crypto from 'crypto';
import { Id } from 'src/decorators/custom.decorator';
import { AddonPurchaseService } from 'src/addon-purchase/addon-purchase.service';
import { RazorpayWebhookEventStatus } from 'src/schemas/RazorpayWebhookEvent.schema';
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

  private resolveSubscriptionIdFromWebhook(parsedBody: any): string {
    return String(
      parsedBody?.payload?.subscription?.entity?.id ||
        parsedBody?.payload?.payment?.entity?.subscription_id ||
        '',
    ).trim();
  }

  private resolveEventCreatedAt(parsedBody: any): Date | undefined {
    const rawCreatedAt =
      parsedBody?.created_at ||
      parsedBody?.payload?.subscription?.entity?.current_start ||
      parsedBody?.payload?.payment?.entity?.created_at;
    const asNumber = Number(rawCreatedAt);
    if (!Number.isFinite(asNumber) || asNumber <= 0) return undefined;
    return new Date(asNumber * 1000);
  }

  /**
   * Razorpay callback hits this API; we respond with a redirect. The Location URL
   * must be absolute. Set `FRONTEND_MAIN_PRODUCTION` in every environment (dev/stage/prod)
   * to your SPA origin, e.g. `http://127.0.0.1:5174` or `https://dashboard.example.com`.
   * If it is missing, `${undefined}/plans` becomes the literal "undefined/plans", which
   * browsers resolve under `/api/v1/razorpay/` → 404.
   */
  private getFrontendOriginForPostPaymentRedirect(): string {
    const raw = this.configService.get<string>('FRONTEND_MAIN_PRODUCTION');
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    if (!trimmed) {
      this.logger.error(
        JSON.stringify({
          scope: 'RazorpayController',
          phase: 'frontend_redirect_misconfiguration',
          message:
            'FRONTEND_MAIN_PRODUCTION is not set. Set it to your SPA base URL (absolute origin, no path suffix) for Razorpay post-payment redirects.',
        }),
      );
      throw new InternalServerErrorException(
        'Server misconfiguration: FRONTEND_MAIN_PRODUCTION is required for Razorpay redirects.',
      );
    }
    return trimmed.replace(/\/+$/, '');
  }

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
    this.logger.log(
      JSON.stringify({
        scope: 'RazorpayController',
        endpoint: 'POST /razorpay/checkout',
        phase: 'received',
        adminId,
        planId: plan,
        durationType,
        hasIdempotencyKey: Boolean(key),
      }),
    );
    return this.razorpayService.createPlanOrder(plan, durationType, adminId, {
      idempotencyKey: key,
    });
  }

  @Post('/payment-success')
  @Redirect()
  async paymentSuccess(
    @Body() body: RazorPayPaymentSuccessBodyDTO,
    @Query() query?: Partial<RazorPayUpdatePlanDTO>,
  ): Promise<any> {
    const frontendOrigin = this.getFrontendOriginForPostPaymentRedirect();
    const failedUrl = `${frontendOrigin}/failed`;

    const isSubscriptionFlow = Boolean(body.razorpay_subscription_id);
    const isOrderFlow = Boolean(body.razorpay_order_id);
    this.logger.log(
      JSON.stringify({
        scope: 'RazorpayController',
        endpoint: 'POST /razorpay/payment-success',
        phase: 'received',
        flow: isSubscriptionFlow
          ? 'subscription'
          : isOrderFlow
            ? 'order'
            : 'unknown',
        adminId: query?.adminId ?? null,
        planId: query?.planId ?? null,
        durationType: query?.durationType ?? null,
        razorpaySubscriptionId: body?.razorpay_subscription_id ?? null,
        razorpayOrderId: body?.razorpay_order_id ?? null,
        razorpayPaymentId: body?.razorpay_payment_id ?? null,
      }),
    );

    if (!isSubscriptionFlow && !isOrderFlow) {
      this.logger.warn(
        JSON.stringify({
          scope: 'RazorpayController',
          endpoint: 'POST /razorpay/payment-success',
          phase: 'rejected',
          reason: 'missing_order_and_subscription_id',
        }),
      );
      return { url: failedUrl };
    }
    const signaturePayload = isSubscriptionFlow
      ? `${body.razorpay_payment_id}|${body.razorpay_subscription_id}`
      : `${body.razorpay_order_id}|${body.razorpay_payment_id}`;

    const generatedSignature = crypto
      .createHmac('sha256', this.configService.get('RAZORPAY_KEY_SECRET'))
      .update(signaturePayload)
      .digest('hex');

    if (generatedSignature !== body.razorpay_signature) {
      this.logger.warn(
        JSON.stringify({
          scope: 'RazorpayController',
          endpoint: 'POST /razorpay/payment-success',
          phase: 'rejected',
          reason: 'signature_mismatch',
          flow: isSubscriptionFlow ? 'subscription' : 'order',
          razorpayPaymentId: body?.razorpay_payment_id ?? null,
        }),
      );
      return { url: failedUrl };
    }

    try {
      const paymentId =
        typeof body.razorpay_payment_id === 'string'
          ? body.razorpay_payment_id
          : undefined;
      const providerSubscriptionId = isSubscriptionFlow
        ? String(body.razorpay_subscription_id || '').trim()
        : '';
      if (!providerSubscriptionId) {
        this.logger.warn(
          JSON.stringify({
            scope: 'RazorpayController',
            endpoint: 'POST /razorpay/payment-success',
            phase: 'rejected',
            reason: 'missing_subscription_id_for_recurring_mode',
          }),
        );
        return { url: failedUrl };
      }

      const pendingContext =
        await this.razorpayService.getPlanCheckoutContextByProviderSubscriptionId(
          providerSubscriptionId,
        );
      if (!pendingContext) {
        this.logger.warn(
          JSON.stringify({
            scope: 'RazorpayController',
            endpoint: 'POST /razorpay/payment-success',
            phase: 'rejected',
            reason: 'pending_checkout_context_not_found',
            providerSubscriptionId,
            providerPaymentId: paymentId ?? null,
          }),
        );
        return { url: failedUrl };
      }
      const resolvedAdminId = pendingContext.admin?.toString?.() ?? '';
      const resolvedPlanId = pendingContext.plan?.toString?.() ?? '';
      const resolvedDurationType = pendingContext.durationType;
      const queryProvided =
        typeof query?.adminId === 'string' &&
        typeof query?.planId === 'string' &&
        typeof query?.durationType === 'string';
      if (queryProvided) {
        const hasMismatch =
          query.adminId !== resolvedAdminId ||
          query.planId !== resolvedPlanId ||
          query.durationType !== resolvedDurationType;
        if (hasMismatch) {
          this.logger.warn(
            JSON.stringify({
              scope: 'RazorpayController',
              endpoint: 'POST /razorpay/payment-success',
              phase: 'query_context_mismatch',
              providerSubscriptionId,
              queryAdminId: query?.adminId ?? null,
              queryPlanId: query?.planId ?? null,
              queryDurationType: query?.durationType ?? null,
              resolvedAdminId,
              resolvedPlanId,
              resolvedDurationType,
            }),
          );
        }
      }
      this.logger.log(
        JSON.stringify({
          scope: 'RazorpayController',
          endpoint: 'POST /razorpay/payment-success',
          phase: 'updateClientPlan_start',
          adminId: resolvedAdminId,
          planId: resolvedPlanId,
          durationType: resolvedDurationType,
          pendingContextId: pendingContext?._id?.toString?.() ?? null,
          providerSubscriptionId,
          providerPaymentId: paymentId ?? null,
        }),
      );

      const planUpdate = await this.subscriptionService.updateClientPlan(
        resolvedAdminId,
        resolvedPlanId,
        resolvedDurationType,
        isSubscriptionFlow ? body.razorpay_subscription_id : undefined,
        paymentId,
      );

      if (planUpdate) {
        await this.razorpayService.markPlanCheckoutContextCompleted({
          providerSubscriptionId,
          providerPaymentId: paymentId,
        });
        this.logger.log(
          JSON.stringify({
            scope: 'RazorpayController',
            endpoint: 'POST /razorpay/payment-success',
            phase: 'completed',
            outcome: 'plan_updated',
            adminId: resolvedAdminId,
            planId: resolvedPlanId,
            durationType: resolvedDurationType,
            flow: isSubscriptionFlow ? 'subscription' : 'order',
            pendingContextId: pendingContext?._id?.toString?.() ?? null,
            providerSubscriptionId,
            providerPaymentId: paymentId ?? null,
          }),
        );
        return {
          url: `${frontendOrigin}/plans`,
        };
      } else {
        await this.razorpayService.markPlanCheckoutContextFailed({
          providerSubscriptionId,
          failureReason: 'plan_update_returned_falsy',
          providerPaymentId: paymentId,
        });
        this.logger.warn(
          JSON.stringify({
            scope: 'RazorpayController',
            endpoint: 'POST /razorpay/payment-success',
            phase: 'completed',
            outcome: 'plan_update_returned_falsy',
            adminId: resolvedAdminId,
            planId: resolvedPlanId,
            durationType: resolvedDurationType,
            pendingContextId: pendingContext?._id?.toString?.() ?? null,
            providerSubscriptionId,
            providerPaymentId: paymentId ?? null,
          }),
        );
        return {
          url: failedUrl,
        };
      }
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (body?.razorpay_subscription_id) {
        await this.razorpayService.markPlanCheckoutContextFailed({
          providerSubscriptionId: body.razorpay_subscription_id,
          failureReason: err.message,
          providerPaymentId: body?.razorpay_payment_id,
        });
      }
      this.logger.error(
        JSON.stringify({
          scope: 'RazorpayController',
          endpoint: 'POST /razorpay/payment-success',
          phase: 'error',
          adminId: query?.adminId ?? null,
          planId: query?.planId ?? null,
          durationType: query?.durationType ?? null,
          providerSubscriptionId: body?.razorpay_subscription_id ?? null,
          providerPaymentId: body?.razorpay_payment_id ?? null,
          message: err.message,
          stack: err.stack ?? null,
        }),
      );
      return {
        url: failedUrl,
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
    const frontendOrigin = this.getFrontendOriginForPostPaymentRedirect();
    const failedUrl = `${frontendOrigin}/failed`;

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
        url: `${frontendOrigin}/addons/${query.adminId}?purchaseId=${finalizeResult.purchaseId}`,
      };
    } else {
      return {
        url: failedUrl,
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
  @HttpCode(200)
  async handleWebhook(@Body() body: any, @Req() req: any) {
    const signature = req.headers['x-razorpay-signature'];
    const rawBody: Buffer | null = Buffer.isBuffer(req?.body)
      ? (req.body as Buffer)
      : null;
    const parsedBody =
      rawBody !== null ? JSON.parse(rawBody.toString('utf8')) : body;
    this.logger.log(
      JSON.stringify({
        scope: 'RazorpayWebhook',
        phase: 'received',
        body: JSON.stringify(parsedBody),
        usedRawBody: Boolean(rawBody),
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
      throw new BadRequestException('Missing x-razorpay-signature header');
    }

    try {
      // Razorpay validation requires raw body. For simplicity in this plan,
      // prefer raw bytes; fallback to JSON stringified body only if absent.
      const generatedSignature = crypto
        .createHmac('sha256', this.configService.get('RAZORPAY_WEBHOOK_SECRET'))
        .update(rawBody ?? Buffer.from(JSON.stringify(parsedBody)))
        .digest('hex');

      // Note: In production, consider taking req.rawBody or using express.raw()
      // if generateSignature doesn't match the Razorpay signature exactly.
      if (generatedSignature !== signature) {
        this.logger.warn(
          JSON.stringify({
            scope: 'RazorpayWebhook',
            outcome: 'rejected',
            reason: 'signature_mismatch',
            event: parsedBody?.event ?? null,
          }),
        );
        throw new BadRequestException('Invalid webhook signature');
      }

      this.logger.log(
        JSON.stringify({
          scope: 'RazorpayWebhook',
          phase: 'verified',
          flowStage: 'webhook_raw_body_mode',
          webhookRawBodyMode: rawBody ? 'raw_buffer' : 'json_fallback',
          event: parsedBody?.event ?? null,
          hasSubscriptionEntity: Boolean(
            parsedBody?.payload?.subscription?.entity,
          ),
          hasPaymentEntity: Boolean(parsedBody?.payload?.payment?.entity),
        }),
      );

      const eventType = String(parsedBody?.event || '').trim();
      const providerEventId = String(parsedBody?.event_id || '').trim();
      const eventCreatedAt = this.resolveEventCreatedAt(parsedBody);
      const dedupe =
        await this.razorpayService.startWebhookEventProcessing({
          providerEventId,
          eventType,
          eventCreatedAt,
        });
      if (!dedupe.shouldProcess) {
        this.logger.log(
          JSON.stringify({
            scope: 'RazorpayWebhook',
            phase: 'noop',
            event: eventType || null,
            providerEventId: providerEventId || null,
            reason: dedupe.reason || 'duplicate_event',
          }),
        );
        return { status: 'ok' };
      }

      const subscriptionId = this.resolveSubscriptionIdFromWebhook(parsedBody);
      const subscription = subscriptionId
        ? await this.subscriptionService.findByProviderSubscriptionId(
            subscriptionId,
          )
        : null;
      if (
        subscription &&
        eventCreatedAt &&
        subscription.razorpayLastWebhookEventAt &&
        eventCreatedAt.getTime() <
          new Date(subscription.razorpayLastWebhookEventAt).getTime()
      ) {
        await this.razorpayService.completeWebhookEventProcessing({
          providerEventId,
          status: RazorpayWebhookEventStatus.IGNORED,
          reason: 'stale_event_ordering',
        });
        this.logger.log(
          JSON.stringify({
            scope: 'RazorpayWebhook',
            phase: 'noop',
            event: eventType || null,
            providerEventId: providerEventId || null,
            subscriptionId,
            reason: 'stale_event_ordering',
          }),
        );
        return { status: 'ok' };
      }

      let processed = false;
      if (eventType === 'subscription.charged') {
        const payload = parsedBody.payload.subscription.entity;
        const payment = parsedBody.payload.payment.entity;
        await this.subscriptionService.handleSubscriptionCharged(
          payload.id,
          payload.notes?.adminId,
          payment,
          payload,
        );
        processed = true;
      } else if (eventType === 'subscription.cancelled') {
        const payload = parsedBody.payload.subscription.entity;
        await this.subscriptionService.handleSubscriptionCancelled(
          payload.id,
          'cancelled',
        );
        processed = true;
      } else if (eventType === 'subscription.halted') {
        const payload = parsedBody.payload.subscription.entity;
        await this.subscriptionService.handleSubscriptionCancelled(
          payload.id,
          'halted',
        );
        processed = true;
      } else if (eventType === 'payment.failed') {
        const payment = parsedBody?.payload?.payment?.entity;
        const failedSubscriptionId = String(payment?.subscription_id || '').trim();
        if (failedSubscriptionId) {
          await this.subscriptionService.handleSubscriptionPaymentFailed(
            failedSubscriptionId,
            payment,
          );
          processed = true;
        }
      } else if (
        eventType === 'subscription.activated' ||
        eventType === 'subscription.pending' ||
        eventType === 'subscription.completed' ||
        eventType === 'subscription.updated'
      ) {
        const payload = parsedBody?.payload?.subscription?.entity;
        const normalizedStatus =
          eventType === 'subscription.activated'
            ? 'active'
            : eventType === 'subscription.pending'
              ? 'pending'
              : eventType === 'subscription.completed'
                ? 'completed'
                : String(payload?.status || '').toLowerCase();
        if (payload?.id && normalizedStatus) {
          await this.subscriptionService.handleSubscriptionStatusSync(
            payload.id,
            normalizedStatus,
          );
          processed = true;
        }
      }

      await this.razorpayService.completeWebhookEventProcessing({
        providerEventId,
        status: processed
          ? RazorpayWebhookEventStatus.PROCESSED
          : RazorpayWebhookEventStatus.IGNORED,
        reason: processed ? undefined : 'unhandled_event_type',
      });

      this.logger.log(
        JSON.stringify({
          scope: 'RazorpayWebhook',
          phase: processed ? 'handled' : 'noop',
          event: eventType || null,
          providerEventId: providerEventId || null,
          subscriptionId: subscriptionId || null,
          reason: processed ? null : 'unhandled_event_type',
        }),
      );

      return { status: 'ok' };
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      const providerEventId = String(
        req?.body?.event_id || body?.event_id || '',
      ).trim();
      if (providerEventId) {
        await this.razorpayService.completeWebhookEventProcessing({
          providerEventId,
          status: RazorpayWebhookEventStatus.FAILED,
          reason: err.message,
        });
      }
      if (e instanceof BadRequestException) {
        throw e;
      }
      this.logger.error(
        JSON.stringify({
          scope: 'RazorpayWebhook',
          phase: 'error',
          message: err.message,
          stack: err.stack ?? null,
        }),
      );
      throw new InternalServerErrorException(err.message);
    }
  }
}
