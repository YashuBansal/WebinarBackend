import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ChatbotTriggerDocument = ChatbotTrigger & Document;

export type ResponseType = 'link' | 'text';

@Schema({ timestamps: true, collection: 'chatbot_triggers' })
export class ChatbotTrigger {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  adminId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  projectId: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, lowercase: true })
  keyword: string;

  @Prop({ type: String, enum: ['link', 'text'], required: true })
  responseType: ResponseType;

  @Prop({ type: String, required: true })
  responseValue: string;

  @Prop({ type: Boolean, default: true })
  enabled: boolean;
}

export const ChatbotTriggerSchema =
  SchemaFactory.createForClass(ChatbotTrigger);

ChatbotTriggerSchema.index({ projectId: 1, keyword: 1 }, { unique: true });
