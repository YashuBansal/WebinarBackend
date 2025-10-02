import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true })
export class ZoomProject {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  adminId: Types.ObjectId;

  @Prop({ type: String })
  accountId?: string;

  @Prop({ type: String })
  accessToken?: string;

  @Prop({ type: String })
  refreshToken?: string;

  @Prop({ type: Date })
  accessTokenExpiresAt?: Date;
}

export type ZoomProjectDocument = HydratedDocument<ZoomProject>;
export const ZoomProjectSchema = SchemaFactory.createForClass(ZoomProject);
ZoomProjectSchema.index({ adminId: 1, accountId: 1 }, { unique: true });

