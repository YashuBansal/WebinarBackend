import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from './User.schema';
import { Subscription } from '../subscription/Subscription.schema';
import { AddOn } from './addon.schema';

export enum AddonPurchaseStatus {
  CREATED = 'CREATED',
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  PAID = 'PAID',
  APPLIED = 'APPLIED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

export enum PaymentProvider {
  RAZORPAY = 'razorpay',
}

@Schema({ timestamps: true })
export class AddonPurchase extends Document {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  admin: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: Subscription.name, required: true })
  subscription: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: AddOn.name, required: true })
  addon: Types.ObjectId;

  @Prop({ type: String, enum: AddonPurchaseStatus, required: true })
  status: AddonPurchaseStatus;

  // Client-provided idempotency key (per admin)
  @Prop({ type: String, required: true })
  idempotencyKey: string;

  @Prop({ type: String, enum: PaymentProvider, required: true })
  provider: PaymentProvider;

  // Provider identifiers (idempotency for webhooks/finalization)
  @Prop({ type: String })
  providerOrderId?: string;

  /** Razorpay subscription id (sub_…) for subscription checkout add-on purchases. */
  @Prop({ type: String })
  providerRazorpaySubscriptionId?: string;

  /** Razorpay subscription.status (e.g. active, halted, cancelled, completed). */
  @Prop({ type: String })
  providerRazorpaySubscriptionStatus?: string;

  /** Hosted checkout / customer-facing URL returned by Razorpay for this subscription. */
  @Prop({ type: String })
  providerRazorpaySubscriptionShortUrl?: string;

  @Prop({ type: String })
  providerPaymentId?: string;

  // Amount captured/expected (informational + reconciliation)
  @Prop({ type: Number, min: 0 })
  amount?: number;

  @Prop({ type: String, default: 'INR' })
  currency?: string;

  @Prop({ type: Number, min: 0, default: 0 })
  attempts: number;

  @Prop({ type: String })
  lastError?: string;
}

export const AddonPurchaseSchema = SchemaFactory.createForClass(AddonPurchase);

AddonPurchaseSchema.index({ admin: 1, idempotencyKey: 1 }, { unique: true });
AddonPurchaseSchema.index(
  { provider: 1, providerOrderId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      providerOrderId: { $type: 'string' },
    },
  },
);
AddonPurchaseSchema.index(
  { provider: 1, providerPaymentId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      providerPaymentId: { $type: 'string' },
    },
  },
);

// Never persist nulls for optional provider IDs (null breaks unique indexes)
AddonPurchaseSchema.pre('save', function (next) {
  if (this.providerOrderId === null) this.providerOrderId = undefined;
  if (this.providerRazorpaySubscriptionId === null) {
    this.providerRazorpaySubscriptionId = undefined;
  }
  if (this.providerRazorpaySubscriptionStatus === null) {
    this.providerRazorpaySubscriptionStatus = undefined;
  }
  if (this.providerRazorpaySubscriptionShortUrl === null) {
    this.providerRazorpaySubscriptionShortUrl = undefined;
  }
  if (this.providerPaymentId === null) this.providerPaymentId = undefined;
  next();
});
