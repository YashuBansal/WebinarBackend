import {
  BadRequestException,
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

type RazorpaySdkError = {
  statusCode?: number;
  error?: { description?: string; message?: string; code?: string } | string;
};

/** Trim, strip invisible chars, extract plan_… from pasted dashboard URLs. */
function sanitizeRazorpayPlanId(raw: string): string {
  let s = raw.trim().replace(/[\u200B-\u200D\uFEFF]/g, '');
  const embedded = s.match(/\b(plan_[A-Za-z0-9]+)\b/);
  if (
    embedded &&
    (s.includes('razorpay.com') || s.toLowerCase().includes('http'))
  ) {
    return embedded[1];
  }
  return s;
}

@Injectable()
export class RazorpayService {
  private readonly logger = new Logger(RazorpayService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly subscriptionService: SubscriptionService,
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

  async createOrder(
    amount: number,
    meta?: {
      receipt?: string;
      notes?: Record<string, string>;
    },
  ) {
    const instance = new Razorpay({
      key_id: this.configService.get('RAZORPAY_KEY_ID'),
      key_secret: this.configService.get('RAZORPAY_KEY_SECRET'),
    });

    const orderOptions: any = {
      amount: Math.floor(amount * 100),
      currency: 'INR',
      receipt: meta?.receipt,
      notes: meta?.notes,
    };
    try {
      return await instance.orders.create(orderOptions);
    } catch (e) {
      this.logger.warn(
        JSON.stringify({
          scope: 'RazorpayService',
          method: 'createOrder',
          outcome: 'error',
          receipt: meta?.receipt ?? null,
          ...this.razorpaySdkFailureFields(e),
        }),
      );
      this.handleRazorpayError(e);
    }
  }

  async createPlanOrder(
    planId: string,
    durationType: DurationType,
    adminId: string,
  ) {
    const { totalWithGST, planData, isEligible } =
      await this.subscriptionService.validateUserEligibility(
        adminId,
        planId,
        durationType,
      );

    if (!isEligible) {
      throw new BadRequestException('You cannot downgrade the plan');
    }

    const durationConfig = planData.planDurationConfig.get(durationType);
    const razorpayPlanIdRaw =
      typeof durationConfig?.razorpayPlanId === 'string'
        ? durationConfig.razorpayPlanId
        : '';
    const razorpayPlanId = razorpayPlanIdRaw
      ? sanitizeRazorpayPlanId(razorpayPlanIdRaw)
      : '';
    if (durationConfig && razorpayPlanId) {
      // If a razorpayPlanId exists, use the Subscriptions API
      const instance = new Razorpay({
        key_id: this.configService.get('RAZORPAY_KEY_ID'),
        key_secret: this.configService.get('RAZORPAY_KEY_SECRET'),
      });

      const invalidPlanHint =
        `(Configured razorpayPlanId for "${durationType}": "${razorpayPlanId}". ` +
        `Open Razorpay Dashboard → Subscriptions → Plans, copy the Plan ID for this billing cycle, ` +
        `and ensure it belongs to the same account and mode—test vs live—as RAZORPAY_KEY_ID on the server.)`;

      try {
        const result = await instance.subscriptions.create({
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
          }),
        );
        return { planData, result, checkoutMode: 'subscription' };
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
            ...this.razorpaySdkFailureFields(e),
          }),
        );
        this.handleRazorpayError(
          e,
          this.isLikelyInvalidRazorpayPlanIdError(e)
            ? invalidPlanHint
            : undefined,
        );
      }
    }

    const result = await this.createOrder(totalWithGST);
    this.logger.log(
      JSON.stringify({
        scope: 'RazorpayService',
        method: 'createPlanOrder',
        outcome: 'ok',
        checkoutMode: 'order',
        adminId,
        planId,
        durationType,
        orderId: result.id,
      }),
    );
    return { planData, result, checkoutMode: 'order' };
  }

  async createAddonOrder(
    addon: string,
    adminId: string,
    meta?: { purchaseId?: string },
  ) {
    const subscription =
      await this.subscriptionService.getSubscription(adminId);
    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    const addonData = await this.addonService.getAddOnById(addon);

    if (!addonData) throw new NotAcceptableException('Addon not found.');

    const { totalAmount } = this.subscriptionService.generatePriceForAddon(
      addonData.addOnPrice,
    );
    const result = await this.createOrder(totalAmount, {
      receipt: meta?.purchaseId
        ? `addon_purchase_${meta.purchaseId}`
        : undefined,
      notes: meta?.purchaseId ? { purchaseId: meta.purchaseId } : undefined,
    });
    this.logger.log(
      JSON.stringify({
        scope: 'RazorpayService',
        method: 'createAddonOrder',
        outcome: 'ok',
        adminId,
        addonId: addon,
        orderId: result.id,
        purchaseId: meta?.purchaseId ?? null,
      }),
    );
    return { addonData, result };
  }
}
