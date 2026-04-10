import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Project } from 'src/schemas/project.schema';
import { User } from 'src/schemas/User.schema';

export type ProfileDocument = Profile & Document;

@Schema({ timestamps: true })
export class Profile extends Document {
  @Prop({
    type: Types.ObjectId,
    ref: Project.name,
    required: true,
    index: true,
  })
  projectId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: User.name,
    required: true,
    index: true,
  })
  adminId: Types.ObjectId;

  @Prop({ type: String, trim: true })
  about?: string;

  @Prop({ type: String, trim: true })
  address?: string;

  @Prop({ type: String, trim: true })
  description?: string;

  @Prop({ type: String, trim: true })
  email?: string;

  @Prop({ type: [String], default: [] })
  websites?: string[];

  @Prop({ type: String, trim: true })
  vertical?: string;

  @Prop({ type: String, trim: true })
  profile_picture_url?: string;

  @Prop({ type: Date })
  last_synced_at?: Date;

  // Cached display name status and related fields
  @Prop({ type: String, trim: true })
  display_name_status?: string;

  @Prop({ type: String, trim: true })
  display_phone_number?: string;

  @Prop({ type: String, trim: true })
  verified_name?: string;

  @Prop({ type: String, trim: true })
  quality_rating?: string;

  @Prop({ type: String, trim: true })
  throughput?: string;

  @Prop({ type: Date })
  display_name_last_synced_at?: Date;

  @Prop({ type: Object, select: false })
  raw?: any;
}

const ProfileSchema = SchemaFactory.createForClass(Profile);

ProfileSchema.index({ projectId: 1, adminId: 1 }, { unique: true });

export { ProfileSchema };
