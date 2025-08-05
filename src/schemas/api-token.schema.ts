import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { User } from './User.schema';

@Schema({ timestamps: true })
export class ApiAccessToken extends Document {
  @Prop({ required: true, type: String })
  label: string;

  @Prop({ required: true, type: String })
  token: string;

  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  user: Types.ObjectId;

  @Prop({ type: Boolean, default: false })
  isExpired: boolean;

  @Prop({ type: Boolean, default: false })
  isDeleted: boolean;

  @Prop({
    type: Date,
    required: false,
  })
  tokenExpiry?: Date;
}

export const ApiAccessTokenSchema =
  SchemaFactory.createForClass(ApiAccessToken);
