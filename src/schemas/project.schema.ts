import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import * as mongoose from 'mongoose';
import { User } from './User.schema';

export type ProjectDocument = Project & mongoose.Document;

@Schema({ timestamps: true })
export class Project {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: User.name,
    required: true,
  })
  adminId: User;

  @Prop({ required: true, trim: true })
  projectName: string;

  @Prop({ trim: true })
  phone: string;

  @Prop({
    type: String,
  })
  appId: string;

  @Prop({
    type: String,
  })
  appSecret: string;

  @Prop({
    type: String,
  })
  wabaId: string;

  @Prop({
    type: String,
  })
  phoneNumberId: string;

  @Prop({
    type: String,
  })
  permanentAccessToken: string;
}

export const ProjectSchema = SchemaFactory.createForClass(Project);
