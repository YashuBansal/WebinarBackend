import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Project } from 'src/schemas/project.schema';
import { User } from 'src/schemas/User.schema';

export type ChatReadStatusDocument = ChatReadStatus & Document;

@Schema({ timestamps: true })
export class ChatReadStatus extends Document {
  @Prop({
    type: Types.ObjectId,
    ref: Project.name,
    required: [true, 'Project ID is required'],
    index: true,
  })
  projectId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: User.name,
    required: [true, 'Admin ID is required'],
    index: true,
  })
  adminId: Types.ObjectId;

  @Prop({
    type: String,
    required: [true, 'Phone number is required'],
    trim: true,
    index: true,
  })
  phoneNumber: string;

  @Prop({
    type: Date,
    required: [true, 'Last read timestamp is required'],
    default: Date.now,
  })
  lastReadAt: Date;
}

const ChatReadStatusSchema = SchemaFactory.createForClass(ChatReadStatus);

// Create compound index for efficient lookups
ChatReadStatusSchema.index(
  { adminId: 1, projectId: 1, phoneNumber: 1 },
  { unique: true },
);

export { ChatReadStatusSchema };
