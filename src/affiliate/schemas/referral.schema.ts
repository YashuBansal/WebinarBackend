import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from 'src/schemas/User.schema';

@Schema({ timestamps: true })
export class Referral extends Document {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  referrerId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  referredId: Types.ObjectId;

  @Prop({ type: Number, required: true, enum: [1, 2] })
  tier: number;

  @Prop({ type: String, required: true, enum: ['signup', 'customer'], default: 'signup' })
  status: string;

  @Prop({ type: Number, default: 0 })
  commission: number;

  @Prop({ type: String, default: '' })
  invoiceId: string;

  @Prop({ type: String, default: '' })
  planPurchased: string;

  @Prop({ type: Date })
  purchaseDate: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const ReferralSchema = SchemaFactory.createForClass(Referral);
