import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from './User.schema';
import { Plans } from 'src/plans/Plans.schema';
import { DurationType } from './BillingHistory.schema';

export enum PlanCheckoutContextStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

@Schema({ timestamps: true })
export class PlanCheckoutContext extends Document {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  admin: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: Plans.name, required: true })
  plan: Types.ObjectId;

  @Prop({ type: String, enum: DurationType, required: true })
  durationType: DurationType;

  @Prop({ type: String, required: true })
  providerSubscriptionId: string;

  @Prop({ type: String })
  providerPaymentId?: string;

  @Prop({ type: String, enum: PlanCheckoutContextStatus, required: true })
  status: PlanCheckoutContextStatus;

  @Prop({ type: String })
  idempotencyKey?: string;

  @Prop({ type: String })
  failureReason?: string;
}

export const PlanCheckoutContextSchema =
  SchemaFactory.createForClass(PlanCheckoutContext);

PlanCheckoutContextSchema.index({ providerSubscriptionId: 1 }, { unique: true });
PlanCheckoutContextSchema.index({ admin: 1, status: 1, createdAt: -1 });
PlanCheckoutContextSchema.index(
  { admin: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      idempotencyKey: { $type: 'string' },
    },
  },
);
