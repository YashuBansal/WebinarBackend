import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from './User.schema';

@Schema({ timestamps: true })
export class NoticeBoard extends Document {
  @Prop({ required: true })
  content: string;

  @Prop({ required: true, enum: ['sales', 'reminder'] })
  type: string; // Adding the new 'type' field

  @Prop({
    type: Types.ObjectId,
    ref: User.name,
    required: [true, 'Admin ID is required'],
  })
  adminId: Types.ObjectId;
}

export const NoticeBoardSchema = SchemaFactory.createForClass(NoticeBoard);
