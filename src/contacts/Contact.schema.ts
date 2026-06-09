import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from '../schemas/User.schema';
import { Project } from '../schemas/project.schema';

export type ContactDocument = Contact & Document;

@Schema({ timestamps: true })
export class Contact extends Document {
  @Prop({
    type: String,
    required: false,
    trim: true,
    maxlength: 100,
  })
  firstName: string;

  @Prop({
    type: String,
    trim: true,
    maxlength: 100,
  })
  lastName: string;

  @Prop({
    type: String,
    required: [true, 'Phone number is required'],
    trim: true,
    maxlength: 20,
  })
  phone: string;

  @Prop({
    type: String,
    required: false,
    trim: true,
    lowercase: true,
    maxlength: 255,
  })
  email: string;

  @Prop({
    type: [String],
    default: [],
  })
  crmTags: string[];

  @Prop({
    type: [String],
    default: [],
  })
  wabaTags: string[];

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

  @Prop({
    type: Boolean,
    default: true,
  })
  isActive: boolean;

  @Prop({
    type: Boolean,
    default: false,
  })
  isDeleted: boolean;
}

const ContactSchema = SchemaFactory.createForClass(Contact);

// Pre-save middleware to convert string IDs to ObjectIds
ContactSchema.pre('save', function (next) {
  if (typeof this.projectId === 'string') {
    this.projectId = new Types.ObjectId(`${this.projectId}`);
  }
  if (typeof this.adminId === 'string') {
    this.adminId = new Types.ObjectId(`${this.adminId}`);
  }
  next();
});

// Create indexes for better query performance
ContactSchema.index({ adminId: 1, projectId: 1 });
ContactSchema.index({ email: 1, adminId: 1 });
ContactSchema.index({ phone: 1, adminId: 1 });
ContactSchema.index({ phone: 1, adminId: 1, isDeleted: 1 });
ContactSchema.index({ phone: 1, projectId: 1, isDeleted: 1 });
ContactSchema.index({ createdAt: -1 });

export { ContactSchema };
