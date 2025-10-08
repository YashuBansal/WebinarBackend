import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type WebinarAutoMessageDocument = WebinarAutoMessage & Document;

export class VariableMapping {
  @Prop({ type: String, required: true })
  variable: string; // e.g., {{1}}

  @Prop({ type: Boolean, default: true })
  isDynamic: boolean;

  @Prop({ type: String })
  contactField?: string; // when isDynamic

  @Prop({ type: String })
  staticValue?: string; // when !isDynamic

  @Prop({ type: String })
  fallbackValue?: string;
}

@Schema({ timestamps: true })
export class WebinarAutoMessage extends Document {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  adminId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  projectId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  webinarId: Types.ObjectId;

  @Prop({ type: Boolean, default: false })
  enabled: boolean;

  @Prop({ type: String, required: true })
  templateName: string;

  @Prop({ type: String, default: 'en_US' })
  language: string;

  @Prop({ type: String, required: false })
  headerMediaAssetId?: string;

  @Prop({ type: [VariableMapping], default: [] })
  variableMappings: VariableMapping[];

  @Prop({ type: Number, default: 0 })
  sent: number;

  @Prop({ type: Number, default: 0 })
  failed: number;

  @Prop({ type: Date, required: false })
  lastSentAt?: Date;

  @Prop({ type: String, required: false })
  lastError?: string;
}

export const WebinarAutoMessageSchema = SchemaFactory.createForClass(WebinarAutoMessage);
WebinarAutoMessageSchema.index({ adminId: 1, webinarId: 1 }, { unique: true });

