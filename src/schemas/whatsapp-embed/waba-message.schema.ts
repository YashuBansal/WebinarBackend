import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Campaign } from './campaign.schema';
import { Contact } from '../Contact.schema';
import { Project } from '../project.schema';
import { User } from '../User.schema';

export type WabaMessageDocument = WabaMessage & Document;

// Status History sub-schema
@Schema({ _id: false })
export class StatusHistory {
  @Prop({
    type: String,
    required: [true, 'Status is required'],
    enum: ['pending', 'sent', 'delivered', 'read', 'failed', 'clicked'],
  })
  status: string;

  @Prop({
    type: Date,
    default: Date.now,
  })
  timestamp: Date;
}

@Schema({ timestamps: true })
export class WabaMessage extends Document {
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
    type: Types.ObjectId,
    ref: Campaign.name,
    required: false,
    index: true,
  })
  campaignId?: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: Contact.name,
    required: false,
    // required: [true, 'Contact ID is required'],
  })
  contactId?: Types.ObjectId;

  @Prop({
    type: String,
    required: [true, 'WABA message ID is required'],
    trim: true,
    unique: true,
  })
  wabaMessageId: string;

  @Prop({
    type: String,
    enum: ['pending', 'sent', 'delivered', 'read', 'failed', 'clicked'],
    default: 'pending',
    required: [true, 'Status is required'],
  })
  status: string;

  @Prop({
    type: String,
    enum: ['campaign', 'individual', 'template'],
    default: 'individual',
  })
  messageType: string;

  @Prop({
    type: String,
    required: [true, 'Template name is required'],
    trim: true,
  })
  templateName: string;

  @Prop({
    type: [StatusHistory],
    default: [],
  })
  statusHistory: StatusHistory[];

  @Prop({
    type: String,
    trim: true,
  })
  failureReason: string;

  @Prop({
    type: Date,
  })
  sentAt: Date;

  @Prop({
    type: Date,
  })
  deliveredAt: Date;

  @Prop({
    type: Date,
  })
  readAt: Date;

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

const WabaMessageSchema = SchemaFactory.createForClass(WabaMessage);

// Pre-save middleware to convert string IDs to ObjectIds
WabaMessageSchema.pre('save', function (next) {
  if (typeof this.projectId === 'string') {
    this.projectId = new Types.ObjectId(`${this.projectId}`);
  }
  if (typeof this.adminId === 'string') {
    this.adminId = new Types.ObjectId(`${this.adminId}`);
  }
  if (this.campaignId && typeof this.campaignId === 'string') {
    this.campaignId = new Types.ObjectId(`${this.campaignId}`);
  }
  if (typeof this.contactId === 'string') {
    this.contactId = new Types.ObjectId(`${this.contactId}`);
  }
  next();
});

// Pre-save middleware to add status to history when status changes
WabaMessageSchema.pre('save', function (next) {
  if (this.isModified('status')) {
    if (!this.statusHistory) {
      this.statusHistory = [];
    }
    this.statusHistory.push({
      status: this.status,
      timestamp: new Date(),
    });
  }
  next();
});

// Create indexes for better query performance
WabaMessageSchema.index({ projectId: 1, status: 1 });
WabaMessageSchema.index({ adminId: 1, status: 1 });
WabaMessageSchema.index({ campaignId: 1, status: 1 });
WabaMessageSchema.index({ contactId: 1 });
WabaMessageSchema.index({ wabaMessageId: 1 });
WabaMessageSchema.index({ status: 1, createdAt: -1 });
WabaMessageSchema.index({ sentAt: -1 });
WabaMessageSchema.index({ deliveredAt: -1 });
WabaMessageSchema.index({ readAt: -1 });

export { WabaMessageSchema };
