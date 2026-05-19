import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from 'src/schemas/User.schema';

@Schema({ timestamps: true })
export class Payout extends Document {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  userId: Types.ObjectId;

  @Prop({ type: Number, required: true })
  amount: number;

  @Prop({ type: String, required: true, enum: ['Requested', 'Processing', 'Completed', 'Rejected'], default: 'Requested' })
  status: string;

  @Prop({ type: String, required: true })
  invoiceRef: string; // e.g. WLH-AFF-2026-001

  createdAt: Date;
  updatedAt: Date;
}

export const PayoutSchema = SchemaFactory.createForClass(Payout);
