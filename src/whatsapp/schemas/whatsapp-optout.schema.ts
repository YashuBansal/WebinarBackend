import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type WhatsappOptoutDocument = WhatsappOptout & Document;

@Schema({ timestamps: true })
export class WhatsappOptout {
  @Prop({ type: Types.ObjectId, ref: 'Project', required: true, index: true })
  projectId: Types.ObjectId;

  @Prop({ required: true, index: true })
  phoneNumber: string;

  @Prop({ default: 'stop_keyword' })
  reason: string;
}

export const WhatsappOptoutSchema =
  SchemaFactory.createForClass(WhatsappOptout);

WhatsappOptoutSchema.index({ projectId: 1, phoneNumber: 1 }, { unique: true });
