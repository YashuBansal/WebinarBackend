import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true })
export class ZoomProject {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  adminId: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  projectName: string;

  @Prop({ type: String })
  accountId?: string;

  @Prop({ type: String, select: false })
  accessToken?: string;

  @Prop({ type: String, select: false })
  refreshToken?: string;

  @Prop({ type: Date })
  accessTokenExpiresAt?: Date;

  @Prop({ type: Boolean, default: false })
  isConfigured: boolean;

  /** General Zoom Marketplace OAuth app (SPA flow); false for legacy server-app credentials and pre-migration rows. */
  @Prop({ type: Boolean, default: false })
  usesMarketplaceGeneralApp: boolean;

  @Prop({ type: String, select: false })
  secretToken?: string;

  @Prop({ type: String })
  clientId?: string;

  @Prop({ type: String, select: false })
  clientSecret?: string;
}

export type ZoomProjectDocument = HydratedDocument<ZoomProject>;
export const ZoomProjectSchema = SchemaFactory.createForClass(ZoomProject);
ZoomProjectSchema.index({ adminId: 1, projectName: 1 }, { unique: true });
