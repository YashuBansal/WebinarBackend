import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class ExpiredPablyToken extends Document {
  @Prop({
    type: String,
    required: true,
  })
  token: string;

  @Prop({
    type: Date,
    required: false,
  })
  expiryDate: Date;

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
  })
  user: Types.ObjectId;
}

export const ExpiredPablyTokenSchema =
  SchemaFactory.createForClass(ExpiredPablyToken);
