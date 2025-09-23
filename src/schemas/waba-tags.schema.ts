import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from './User.schema';
import { Project } from './project.schema';

export type WabaTagDocument = WabaTag & Document;

@Schema({ timestamps: true })
export class WabaTag extends Document {
  @Prop({
    type: String,
    maxlength: 100,
    trim: true,
    required: [true, 'Name is required'],
    lowercase: true,
  })
  name: string;

  @Prop({
    type: Types.ObjectId,
    ref: Project.name,
    required: [true, 'Project ID is required'],
  })
  projectId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: User.name,
    required: [true, 'Admin ID is required'],
  })
  adminId: Types.ObjectId;
}

export const WabaTagSchema = SchemaFactory.createForClass(WabaTag);

// Pre-save middleware to convert string IDs to ObjectIds
WabaTagSchema.pre('save', function (next) {
  if (typeof this.projectId === 'string') {
    this.projectId = new Types.ObjectId(`${this.projectId}`);
  }
  if (typeof this.adminId === 'string') {
    this.adminId = new Types.ObjectId(`${this.adminId}`);
  }
  next();
});

// Create indexes for better query performance
WabaTagSchema.index({ adminId: 1, projectId: 1 });
WabaTagSchema.index({ name: 1, adminId: 1, projectId: 1 }, { unique: true });
WabaTagSchema.index({ createdAt: -1 });
