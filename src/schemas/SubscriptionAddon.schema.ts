import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Subscription } from './Subscription.schema';
import { AddOn } from './addon.schema';
import { AddonPurchase } from './AddonPurchase.schema';

export enum UserAddonStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
}

@Schema({ timestamps: true })
export class SubscriptionAddOn extends Document {
  @Prop({ type: Types.ObjectId, ref: Subscription.name, required: true })
  subscription: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: AddOn.name, required: true })
  addOn: Types.ObjectId;

  // Payment/purchase ledger link (enables idempotency + reconciliation)
  @Prop({ type: Types.ObjectId, ref: AddonPurchase.name })
  purchase?: Types.ObjectId;

  @Prop({ type: String, enum: UserAddonStatus, default: UserAddonStatus.ACTIVE })
  status: UserAddonStatus;

  @Prop({ type: Date, default: Date.now })
  startAt: Date;

  // For backward compatibility, keep the field name `expiryDate` but treat it as endAt.
  @Prop({ type: Date, required: true })
  expiryDate: Date;

  @Prop({ type: Number, min: 0, default: 0 })
  employeeLimit: number;

  @Prop({ type: Number, min: 0, default: 0 })
  contactLimit: number;

  @Prop({ type: Number, min: 0, default: 0 })
  webinarLimit: number;

  @Prop({ type: Number, min: 0, default: 0 })
  whatsappProjectLimit: number;

  @Prop({ type: Number, min: 0, default: 0 })
  zoomProjectLimit: number;

  // Snapshot what was purchased, so later catalog edits don't mutate history.
  @Prop({ type: Object })
  benefitsSnapshot?: {
    employeeLimit?: number;
    contactLimit?: number;
    webinarLimit?: number;
    whatsappProjectLimit?: number;
    zoomProjectLimit?: number;
    addOnPrice?: number;
    validityInDays?: number;
    addonName?: string;
  };
}

const SubscriptionAddOnSchema = SchemaFactory.createForClass(SubscriptionAddOn);

SubscriptionAddOnSchema.index({ subscription: 1 });
SubscriptionAddOnSchema.index({ status: 1, expiryDate: 1 });
SubscriptionAddOnSchema.index({ purchase: 1 }, { unique: true, sparse: true });
export { SubscriptionAddOnSchema };
