import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Roles } from './Roles.schema';

@Schema({ timestamps: true })
export class SidebarLinks extends Document {
  @Prop({
    type: String,
    required: [true, 'Title is required'],
    minLength: 1,
    maxLength: 50,
    unique: true,
  })
  title: string;

  @Prop({
    type: String,
    required: [true, 'Link is required'],
    minLength: 1,
    maxLength: 2048,
  })
  link: string;

  @Prop({
    type: Types.ObjectId,
    ref: Roles.name,
    default: null,
  })
  role: Types.ObjectId | null;
}

export const SidebarLinksSchema = SchemaFactory.createForClass(SidebarLinks);
