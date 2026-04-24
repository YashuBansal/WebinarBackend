import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotAcceptableException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Razorpay from 'razorpay';
import { AddOnService } from 'src/addon/addon.service';
import { DurationType } from 'src/schemas/BillingHistory.schema';
import { SubscriptionService } from 'src/subscription/subscription.service';
import { sanitizeRazorpayPlanId } from 'src/razorpay/razorpay-plan-id.util';

type RazorpaySdkError = {
  statusCode?: number;
  error?: { description?: string; message?: string; code?: string } | string;
};

@Injectable()
export class RazorpayService {
  private readonly logger = new Logger(RazorpayService.name);

  constructor(
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => SubscriptionService))
    private readonly subscriptionService: SubscriptionService,
    @Inject(forwardRef(() => AddOnService))
    private readonly addonService: AddOnService,
  ) {}

  /** Single-field shape for logging Razorpay Node SDK rejections (non-Error objects). */
  private razorpaySdkFailureFields(err: unknown): {
    statusCode: number | null;
    code: string | null;
    description: string | null;
  } {
    if (!err || typeof err !== 'object' || !('error' in err)) {
      return {
        statusCode: null,
        code: null,
        description:
          err instanceof Error
            ? err.message
            : err === undefined || err === null
              ? 'unknown'
              : String(err),
      };
    }
    const rzp = err as RazorpaySdkError;
    const inner = rzp.error;
    if (typeof inner === 'string') {
      return {
        statusCode: rzp.statusCode ?? null,
        code: null,
        description: inner,
      };
    }
    if (inner && typeof inner === 'object') {
      const o = inner as {
        description?: string;
        message?: string;
        code?: string;
      };
      return {
        statusCode: rzp.statusCode ?? null,
        code: o.code ?? null,
        description: o.description || o.message || null,
      };
    }
    return {
      statusCode: rzp.statusCode ?? null,
      code: null,
      description: null,
    };
  }

  /**
   * Razorpay's Node SDK rejects with a plain object `{ statusCode, error }`, not an Error.
   * Nest would otherwise log "error: undefined" and return an empty 500 body.
   */
  private isLikelyInvalidRazorpayPlanIdError(err: unknown): boolean {
    if (!err || typeof err !== 'object' || !('error' in err)) return false;
    const inner = (err as RazorpaySdkError).error;
    const desc =
      typeof inner === 'object' &&
      inner &&
      typeof (inner as { description?: string }).description === 'string'
        ? (inner as { description: string }).description.toLowerCase()
        : '';
    return (
      desc.includes('invalid') ||
      desc.includes('could not be found') ||
      desc.includes('not found')
    );
  }

  private isIgnorableRazorpayCancelError(err: unknown): boolean {
    const { description } = this.razorpaySdkFailureFields(err);
    const d = (description || '').toLowerCase();
    return (
      d.includes('already been cancelled') ||
      d.includes('already cancelled') ||
      d.includes('subscription is cancelled') ||
      d.includes('not found') ||
      d.includes('does not exist') ||
      d.includes('invalid subscription id')
    );
  }

  /**
   * After payment succeeds and the DB is updated to `newRazorpaySubscriptionId`,
   * cancel the prior Razorpay subscription at the provider so the customer is not double-billed.
   * Does not throw: payment already succeeded; failures are logged for ops follow-up.
   */
  async cancelReplacedProviderSubscription(params: {
    previousRazorpaySubscriptionId?: string | null;
    newRazorpaySubscriptionId?: string | null;
  }): Promise<void> {
    const prev = String(params.previousRazorpaySubscriptionId || '').trim();
    const next = String(params.newRazorpaySubscriptionId || '').trim();
    if (!prev || !next || prev === next) {
      return;
    }

    const razorpay = new Razorpay({
      key_id: this.configService.get('RAZORPAY_KEY_ID'),
      key_secret: this.configService.get('RAZORPAY_KEY_SECRET'),
    });

    try {
      await razorpay.subscriptions.cancel(prev, false);
      this.logger.log(
        JSON.stringify({
          scope: 'RazorpayService',
          method: 'cancelReplacedProviderSubscription',
          outcome: 'cancelled_ok',
          cancelledRazorpaySubscriptionId: prev,
          newRazorpaySubscriptionId: next,
        }),
      );
    } catch (e) {
      if (this.isIgnorableRazorpayCancelError(e)) {
        this.logger.warn(
          JSON.stringify({
            scope: 'RazorpayService',
            method: 'cancelReplacedProviderSubscription',
            outcome: 'cancel_ignorable',
            cancelledRazorpaySubscriptionId: prev,
            newRazorpaySubscriptionId: next,
            ...this.razorpaySdkFailureFields(e),
          }),
        );
      } else {
        this.logger.warn(
          JSON.stringify({
            scope: 'RazorpayService',
            method: 'cancelReplacedProviderSubscription',
            outcome: 'cancel_failed_non_fatal',
            cancelledRazorpaySubscriptionId: prev,
            newRazorpaySubscriptionId: next,
            ...this.razorpaySdkFailureFields(e),
          }),
        );
      }
    }
  }

  private handleRazorpayError(err: unknown, hint?: string): never {
    if (err && typeof err === 'object' && 'error' in err) {
      const rzp = err as RazorpaySdkError;
      const inner = rzp.error;
      let message = 'Razorpay request failed';
      if (typeof inner === 'string') {
        message = inner;
      } else if (inner && typeof inner === 'object') {
        message =
          inner.description ||
          inner.message ||
          inner.code ||
          message;
      }
      if (hint) {
        message = `${message} ${hint}`;
      }
      throw new BadRequestException(message);
    }
    if (err instanceof Error && err.message) {
      throw new BadRequestException(err.message);
    }
    throw new BadRequestException('Razorpay request failed');
  }

  async createPlanOrder(
    planId: string,
    durationType: DurationType,
    adminId: string,
    opts?: { idempotencyKey?: string },
  ) {
    const { planData, isEligible } =
      await this.subscriptionService.validateUserEligibility(
        adminId,
        planId,
        durationType,
      );

    if (!isEligible) {
      throw new BadRequestException('You cannot downgrade the plan');
    }

    const razorpayClient = new Razorpay({
      key_id: this.configService.get('RAZORPAY_KEY_ID'),
      key_secret: this.configService.get('RAZORPAY_KEY_SECRET'),
    });

    const durationConfig = planData.planDurationConfig.get(durationType);
    if (!durationConfig) {
      throw new BadRequestException(
        `No duration config for "${durationType}". Check plan duration settings.`,
      );
    }
    const razorpayPlanIdRaw =
      typeof durationConfig.razorpayPlanId === 'string'
        ? durationConfig.razorpayPlanId
        : '';
    const razorpayPlanId = razorpayPlanIdRaw
      ? sanitizeRazorpayPlanId(razorpayPlanIdRaw)
      : '';
    if (!razorpayPlanId) {
      const invalidPlanHint =
        `Subscription checkout requires a configured razorpayPlanId for "${durationType}". ` +
        `Open Razorpay Dashboard → Subscriptions → Plans, create or copy the plan id (plan_...) ` +
        `and save it on this plan's duration in admin. It must match the same Razorpay mode (test vs live) as the server.`;
      throw new BadRequestException(invalidPlanHint);
    }

    const invalidPlanHintOnApi =
      `(Configured razorpayPlanId for "${durationType}": "${razorpayPlanId}". ` +
      `Open Razorpay Dashboard → Subscriptions → Plans, copy the Plan ID for this billing cycle, ` +
      `and ensure it belongs to the same account and mode—test vs live—as RAZORPAY_KEY_ID on the server.)`;

    try {
      this.logger.log(
        JSON.stringify({
          scope: 'RazorpayService',
          method: 'createPlanOrder',
          phase: 'checkout_start',
          checkoutMode: 'subscription',
          adminId,
          planId,
          durationType,
          idempotencyKey: opts?.idempotencyKey ?? null,
        }),
      );
      const result = await razorpayClient.subscriptions.create({
        plan_id: razorpayPlanId,
        total_count: 120, // max iterations for recurring
        customer_notify: 1,
        notes: {
          adminId: String(adminId),
          planId: String(planId),
          durationType: String(durationType),
        },
      });
      this.logger.log(
        JSON.stringify({
          scope: 'RazorpayService',
          method: 'createPlanOrder',
          outcome: 'ok',
          checkoutMode: 'subscription',
          adminId,
          planId,
          durationType,
          subscriptionId: result.id,
          razorpayPlanId,
          idempotencyKey: opts?.idempotencyKey ?? null,
        }),
      );
      return { planData, result, checkoutMode: 'subscription' as const };
    } catch (e) {
      this.logger.warn(
        JSON.stringify({
          scope: 'RazorpayService',
          method: 'createPlanOrder',
          outcome: 'error',
          checkoutMode: 'subscription',
          adminId,
          planId,
          durationType,
          razorpayPlanId,
          likelyInvalidPlanId: this.isLikelyInvalidRazorpayPlanIdError(e),
          idempotencyKey: opts?.idempotencyKey ?? null,
          ...this.razorpaySdkFailureFields(e),
        }),
      );
      this.handleRazorpayError(
        e,
        this.isLikelyInvalidRazorpayPlanIdError(e)
          ? invalidPlanHintOnApi
          : undefined,
      );
    }
  }

  /**
   * Add-on products use a Razorpay Subscriptions plan (separate `sub_` from the main app subscription).
   */
  async createAddonSubscription(input: {
    addonId: string;
    adminId: string;
    purchaseId: string;
    razorpayPlanId: string;
  }) {
    const subscription =
      await this.subscriptionService.getSubscription(input.adminId);
    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    const addonData = await this.addonService.getAddOnById(input.addonId);
    if (!addonData) throw new NotAcceptableException('Addon not found.');

    const planId = sanitizeRazorpayPlanId(input.razorpayPlanId);
    if (!planId) {
      throw new BadRequestException(
        'Add-on is missing a valid razorpayPlanId (Razorpay Subscriptions plan id, e.g. plan_...).',
      );
    }

    const instance = new Razorpay({
      key_id: this.configService.get('RAZORPAY_KEY_ID'),
      key_secret: this.configService.get('RAZORPAY_KEY_SECRET'),
    });

    const invalidPlanHint =
      `Configured razorpayPlanId: "${planId}". ` +
      `Create an add-on plan in Razorpay Dashboard → Subscriptions → Plans and ` +
      `paste its id; test vs live must match RAZORPAY_KEY_ID.`;

    try {
      const result = await instance.subscriptions.create({
        plan_id: planId,
        total_count: 120, // max iterations for recurring (parity with plan checkout)
        customer_notify: 1,
        notes: {
          purpose: 'addon_purchase',
          purchaseId: String(input.purchaseId),
          adminId: String(input.adminId),
          addonId: String(input.addonId),
        },
      });
      this.logger.log(
        JSON.stringify({
          scope: 'RazorpayService',
          method: 'createAddonSubscription',
          outcome: 'ok',
          adminId: input.adminId,
          addonId: input.addonId,
          purchaseId: input.purchaseId,
          subscriptionId: result.id,
        }),
      );
      return { addonData, result };
    } catch (e) {
      this.logger.warn(
        JSON.stringify({
          scope: 'RazorpayService',
          method: 'createAddonSubscription',
          outcome: 'error',
          adminId: input.adminId,
          addonId: input.addonId,
          planId,
          likelyInvalidPlanId: this.isLikelyInvalidRazorpayPlanIdError(e),
          ...this.razorpaySdkFailureFields(e),
        }),
      );
      this.handleRazorpayError(
        e,
        this.isLikelyInvalidRazorpayPlanIdError(e) ? invalidPlanHint : undefined,
      );
    }
  }
}
