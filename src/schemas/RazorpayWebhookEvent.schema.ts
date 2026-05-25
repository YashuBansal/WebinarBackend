import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export enum RazorpayWebhookEventStatus {
  PROCESSING = 'processing',
  PROCESSED = 'processed',
  IGNORED = 'ignored',
  FAILED = 'failed',
}

@Schema({ timestamps: true })
export class RazorpayWebhookEvent extends Document {
  @Prop({ type: String, required: true })
  provider: string;

  @Prop({ type: String, required: true })
  providerEventId: string;

  @Prop({ type: String, required: true })
  eventType: string;

  @Prop({ type: Date })
  eventCreatedAt?: Date;

  @Prop({ type: String, enum: RazorpayWebhookEventStatus, required: true })
  status: RazorpayWebhookEventStatus;

  @Prop({ type: Date })
  processedAt?: Date;

  @Prop({ type: String })
  reason?: string;
}

export const RazorpayWebhookEventSchema = SchemaFactory.createForClass(
  RazorpayWebhookEvent,
);

RazorpayWebhookEventSchema.index(
  { provider: 1, providerEventId: 1 },
  { unique: true },
);
RazorpayWebhookEventSchema.index({ eventType: 1, createdAt: -1 });
