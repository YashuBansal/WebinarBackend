import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class QuickReply extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Project', required: true, index: true })
  projectId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  adminId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true })
  content: string;

  @Prop({ default: 'en_US' })
  language: string;

  @Prop({ type: [Object], default: [] })
  components: any[];
}

export const QuickReplySchema = SchemaFactory.createForClass(QuickReply);

// Ensure name is unique per project
QuickReplySchema.index({ projectId: 1, name: 1 }, { unique: true });
