import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from 'src/schemas/User.schema';

@Schema({ _id: false })
export class BankDetails {
  @Prop({ default: '' })
  holderName: string;

  @Prop({ default: '' })
  bankBranch: string;

  @Prop({ default: '' })
  accountNumber: string;

  @Prop({ default: '' })
  ifscCode: string;

  @Prop({ default: '' })
  upiId: string;

  @Prop({ default: '' })
  panCardFile: string;
}

@Schema({ timestamps: true })
export class Affiliate extends Document {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true, unique: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true })
  referralCode: string;

  @Prop({ type: Number, default: 20 })
  tier1Rate: number;

  @Prop({ type: Number, default: 2 })
  tier2Rate: number;

  @Prop({ type: BankDetails, default: () => ({}) })
  bankDetails: BankDetails;

  @Prop({ type: Number, default: 0 })
  totalEarned: number;

  @Prop({ type: Number, default: 0 })
  requestablePayout: number;
}

export const AffiliateSchema = SchemaFactory.createForClass(Affiliate);
