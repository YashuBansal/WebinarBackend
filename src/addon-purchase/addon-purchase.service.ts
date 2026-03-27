import {
  BadRequestException,
  Injectable,
  NotAcceptableException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AddonPurchase,
  AddonPurchaseStatus,
  PaymentProvider,
} from 'src/schemas/AddonPurchase.schema';
import { SubscriptionService } from 'src/subscription/subscription.service';
import { AddOnService } from 'src/addon/addon.service';
import { RazorpayService } from 'src/razorpay/razorpay.service';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { SubscriptionAddonService } from 'src/subscription-addon/subscription-addon.service';
import { UserAddonStatus } from 'src/schemas/SubscriptionAddon.schema';
import { BillingHistoryService } from 'src/billing-history/billing-history.service';
import { UsersService } from 'src/users/users.service';

@Injectable()
export class AddonPurchaseService {
  constructor(
    @InjectModel(AddonPurchase.name)
    private readonly addonPurchaseModel: Model<AddonPurchase>,
    private readonly subscriptionService: SubscriptionService,
    private readonly addonService: AddOnService,
    private readonly razorpayService: RazorpayService,
    private readonly subscriptionAddonService: SubscriptionAddonService,
    private readonly billingHistoryService: BillingHistoryService,
    private readonly usersService: UsersService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async onModuleInit() {
    // Fix legacy unique sparse indexes that include null values.
    // Drop old indexes (if present) and recreate via schema definitions.
    try {
      await this.addonPurchaseModel.collection.dropIndex(
        'provider_1_providerPaymentId_1',
      );
    } catch (_) {}
    try {
      await this.addonPurchaseModel.collection.dropIndex(
        'provider_1_providerOrderId_1',
      );
    } catch (_) {}

    try {
      await this.addonPurchaseModel.syncIndexes();
    } catch (_) {}
  }

  async createRazorpayPurchaseOrder({
    adminId,
    addonId,
    idempotencyKey,
  }: {
    adminId: string;
    addonId: string;
    idempotencyKey: string;
  }) {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    const user = await this.usersService.getUserById(adminId);
    if (!user || !user.isActive) {
      throw new NotAcceptableException(
        'Account is inactive. You cannot buy add-ons.',
      );
    }

    const subscription = await this.subscriptionService.getSubscription(adminId);
    const subscriptionExpiry = subscription?.expiryDate
      ? new Date(subscription.expiryDate)
      : null;
    if (
      !subscriptionExpiry ||
      Number.isNaN(subscriptionExpiry.getTime()) ||
      subscriptionExpiry.getTime() <= Date.now()
    ) {
      throw new NotAcceptableException(
        'Subscription has expired. Please renew to buy add-ons.',
      );
    }

    const addon = await this.addonService.getAddOnById(addonId);

    const { totalAmount } = this.subscriptionService.generatePriceForAddon(
      addon.addOnPrice,
    );

    // Create-or-return existing purchase (idempotent).
    const adminObjectId = new Types.ObjectId(adminId);
    const addonObjectId = new Types.ObjectId(addonId);

    const existing = await this.addonPurchaseModel.findOne({
      admin: adminObjectId,
      idempotencyKey,
    });

    if (existing) {
      return {
        purchase: existing,
        order: existing.providerOrderId
          ? {
              id: existing.providerOrderId,
              amount: Math.floor((existing.amount || 0) * 100),
              currency: existing.currency || 'INR',
            }
          : null,
        addon,
      };
    }

    const created = await this.addonPurchaseModel.create({
      admin: adminObjectId,
      subscription: subscription._id,
      addon: addonObjectId,
      status: AddonPurchaseStatus.PENDING_PAYMENT,
      idempotencyKey,
      provider: PaymentProvider.RAZORPAY,
      amount: totalAmount,
      currency: 'INR',
    });

    // Create Razorpay order and store its ID on the purchase.
    const { result: order } = await this.razorpayService.createAddonOrder(
      addonId,
      adminId,
      { purchaseId: created._id.toString() },
    );

    created.providerOrderId = order.id;
    await created.save();

    return { purchase: created, order, addon };
  }

  async getPurchaseById(purchaseId: string) {
    const doc = await this.addonPurchaseModel
      .findById(purchaseId)
      .populate('addon')
      .lean();
    if (!doc) throw new NotFoundException('Purchase not found');
    return doc;
  }

  /**
   * Finalize a purchase from a provider event/webhook.
   * Idempotent under retries and duplicate deliveries.
   */
  async finalizeRazorpayAddonPurchase(params: {
    providerOrderId: string;
    providerPaymentId: string;
    purchaseId?: string;
  }) {
    const { providerOrderId, providerPaymentId, purchaseId } = params;

    const session = await this.connection.startSession();
    session.startTransaction();
    try {
      const purchase = await this.addonPurchaseModel
        .findOne({
          provider: PaymentProvider.RAZORPAY,
          providerOrderId,
          ...(purchaseId ? { _id: new Types.ObjectId(purchaseId) } : {}),
        })
        .session(session);

      if (!purchase) {
        throw new NotFoundException('Purchase not found for order');
      }

      // Idempotency: if already applied, nothing to do.
      if (purchase.status === AddonPurchaseStatus.APPLIED) {
        await session.commitTransaction();
        session.endSession();
        return { ok: true, purchaseId: purchase._id.toString(), status: purchase.status };
      }

      // Record payment id (idempotent set)
      if (!purchase.providerPaymentId) {
        purchase.providerPaymentId = providerPaymentId;
      }
      if (purchase.status === AddonPurchaseStatus.PENDING_PAYMENT) {
        purchase.status = AddonPurchaseStatus.PAID;
      }

      // Clamp addon validity to subscription expiry.
      const subscription = await this.subscriptionService.getSubscription(
        purchase.admin.toString(),
      );
      const addon = await this.addonService.getAddOnById(purchase.addon.toString());
      const now = new Date();
      const fromValidity = new Date(
        now.getTime() + addon.validityInDays * 24 * 60 * 60 * 1000,
      );
      const endAt = subscription.expiryDate
        ? new Date(Math.min(fromValidity.getTime(), new Date(subscription.expiryDate).getTime()))
        : fromValidity;

      const benefitsSnapshot = {
        addonName: addon.addonName,
        employeeLimit: addon.employeeLimit,
        contactLimit: addon.contactLimit,
        webinarLimit: addon.webinarLimit || 0,
        whatsappProjectLimit: addon.whatsappProjectLimit || 0,
        zoomProjectLimit: addon.zoomProjectLimit || 0,
        addOnPrice: addon.addOnPrice,
        validityInDays: addon.validityInDays,
      };

      // Create user-addon record (unique on purchase).
      try {
        await this.subscriptionAddonService.createSubscriptionAddon(
          purchase.subscription.toString(),
          endAt,
          purchase.addon.toString(),
          purchase._id.toString(),
          addon.employeeLimit,
          addon.contactLimit,
          addon.webinarLimit || 0,
          addon.whatsappProjectLimit || 0,
          addon.zoomProjectLimit || 0,
          benefitsSnapshot,
          session,
        );
      } catch (e: any) {
        // If webhook retries or redirect path raced, unique index on purchase may throw.
        // Treat that as already-created and continue to mark purchase as applied.
        const msg = String(e?.message || e);
        if (!msg.includes('E11000')) throw e;
      }

      // Mark PAID in the txn; APPLIED after billing is ensured.
      purchase.status = AddonPurchaseStatus.PAID;
      await purchase.save({ session });

      await session.commitTransaction();
      session.endSession();

      // Create billing history exactly once per purchase (idempotent via unique sparse index).
      const { itemAmount, taxAmount, totalAmount } =
        this.subscriptionService.generatePriceForAddon(addon.addOnPrice);

      try {
        await this.billingHistoryService.addOneBillingHistory(
          purchase.admin.toString(),
          purchase.addon.toString(),
          itemAmount,
          taxAmount,
          totalAmount,
          this.subscriptionService.GST_VALUE || 0,
          purchase._id.toString(),
          { startDate: new Date(), expiryDate: endAt },
        );
      } catch (e: any) {
        const msg = String(e?.message || e);
        if (!msg.includes('E11000')) throw e;
        // Duplicate billing for the same purchase → treat as already created.
      }

      // Recompute totals and mark purchase as APPLIED after billing exists.
      await this.subscriptionService.updateSingleSubscriptionAddon(
        purchase.subscription.toString(),
      );

      await this.addonPurchaseModel.updateOne(
        { _id: purchase._id, status: { $ne: AddonPurchaseStatus.APPLIED } },
        { $set: { status: AddonPurchaseStatus.APPLIED } },
      );

      // Keep response consistent with persisted state.
      purchase.status = AddonPurchaseStatus.APPLIED;
      return {
        ok: true,
        purchaseId: purchase._id.toString(),
        status: purchase.status,
      };
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      throw err;
    }
  }

  /**
   * Daily reconciliation: ensure PAID purchases become APPLIED even if prior apply failed.
   */
  async reconcilePaidPurchases(limit: number = 50) {
    const stuck = await this.addonPurchaseModel
      .find({
        provider: PaymentProvider.RAZORPAY,
        status: AddonPurchaseStatus.PAID,
      })
      .sort({ updatedAt: 1 })
      .limit(limit)
      .lean();

    for (const p of stuck) {
      try {
        if (!p.providerOrderId || !p.providerPaymentId) continue;
        await this.finalizeRazorpayAddonPurchase({
          providerOrderId: p.providerOrderId,
          providerPaymentId: p.providerPaymentId,
          purchaseId: p._id.toString(),
        });
      } catch (_) {
        await this.addonPurchaseModel.updateOne(
          { _id: p._id },
          { $inc: { attempts: 1 }, $set: { lastError: 'reconcile_failed' } },
        );
      }
    }
    return { ok: true, attempted: stuck.length };
  }

  /**
   * Backfill billing histories for already finalized purchases (older flow).
   * Safe under retries due to unique (addonPurchase) index.
   */
  async reconcileMissingAddonBilling(limit: number = 100) {
    const purchases = await this.addonPurchaseModel
      .find({
        provider: PaymentProvider.RAZORPAY,
        status: { $in: [AddonPurchaseStatus.PAID, AddonPurchaseStatus.APPLIED] },
      })
      .sort({ updatedAt: 1 })
      .limit(limit)
      .lean();

    let attempted = 0;
    for (const p of purchases) {
      attempted++;
      try {
        const existing = await this.billingHistoryService.getByAddonPurchaseId(
          p._id.toString(),
        );
        if (existing) continue;

        const addon = await this.addonService.getAddOnById(p.addon.toString());
        const { itemAmount, taxAmount, totalAmount } =
          this.subscriptionService.generatePriceForAddon(addon.addOnPrice);

        const userAddon =
          await this.subscriptionAddonService.getUserAddonByPurchaseId(
            p._id.toString(),
          );

        await this.billingHistoryService.addOneBillingHistory(
          p.admin.toString(),
          p.addon.toString(),
          itemAmount,
          taxAmount,
          totalAmount,
          this.subscriptionService.GST_VALUE || 0,
          p._id.toString(),
          {
            startDate: userAddon?.startAt ? new Date(userAddon.startAt) : undefined,
            expiryDate: userAddon?.expiryDate ? new Date(userAddon.expiryDate) : undefined,
          },
        );
      } catch (_) {
        // best-effort reconciliation; leave counters for observability
        await this.addonPurchaseModel.updateOne(
          { _id: p._id },
          { $inc: { attempts: 1 }, $set: { lastError: 'billing_reconcile_failed' } },
        );
      }
    }

    return { ok: true, attempted };
  }
}

