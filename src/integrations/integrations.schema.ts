import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ _id: false })
export class ConvertKitConfig {
  @Prop({ type: String, default: '' })
  apiKey: string;

  @Prop({ type: String, default: '' })
  apiSecret: string;

  @Prop({ type: Boolean, default: false })
  isActive: boolean;
}

@Schema({ _id: false })
export class AWeberConfig {
  @Prop({ type: String, default: '' })
  apiKey: string;

  @Prop({ type: String, default: '' })
  apiSecret: string;

  @Prop({ type: Boolean, default: false })
  isActive: boolean;
}

@Schema({ _id: false })
export class ActiveCampaignConfig {
  @Prop({ type: String, default: '' })
  apiKey: string;

  @Prop({ type: String, default: '' })
  apiSecret: string;

  @Prop({ type: Boolean, default: false })
  isActive: boolean;
}

@Schema({ _id: false })
export class PabblyEmailConfig {
  @Prop({ type: String, default: '' })
  apiKey: string;

  @Prop({ type: String, default: '' })
  apiSecret: string;

  @Prop({ type: Boolean, default: false })
  isActive: boolean;
}

@Schema({ _id: false })
export class InterestPoolConfig {
  @Prop({ type: String, default: '' })
  accountId: string;

  @Prop({ type: String, default: '' })
  accessToken: string;

  @Prop({ type: Boolean, default: false })
  isActive: boolean;
}

@Schema({ timestamps: true })
export class IntegrationSettings extends Document {
  @Prop({
    type: Types.ObjectId,
    ref: 'users',
    required: true,
    index: true,
    unique: true,
  })
  userId: Types.ObjectId;

  @Prop({ type: ConvertKitConfig, default: () => ({}) })
  convertkit: ConvertKitConfig;

  @Prop({ type: AWeberConfig, default: () => ({}) })
  aweber: AWeberConfig;

  @Prop({ type: ActiveCampaignConfig, default: () => ({}) })
  activecampaign: ActiveCampaignConfig;

  @Prop({ type: PabblyEmailConfig, default: () => ({}) })
  pabblyEmail: PabblyEmailConfig;

  @Prop({ type: InterestPoolConfig, default: () => ({}) })
  interestPool: InterestPoolConfig;
}

export const IntegrationSettingsSchema =
  SchemaFactory.createForClass(IntegrationSettings);
