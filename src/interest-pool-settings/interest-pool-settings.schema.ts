import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class InterestPoolSettings extends Document {
  @Prop({ type: Types.ObjectId, ref: 'users', required: true, index: true, unique: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  accountId: string;

  @Prop({ type: String, required: true })
  accessToken: string;
}

export const InterestPoolSettingsSchema =
  SchemaFactory.createForClass(InterestPoolSettings);

