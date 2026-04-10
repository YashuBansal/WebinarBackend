import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from '../../schemas/User.schema';
import { Project } from '../../schemas/project.schema';
import { VariableMapping } from 'src/webinar-auto-message/webinar-auto-message.schema';

export type CampaignDocument = Campaign & Document;

export enum CampaignStatus {
  DRAFT = 'draft',
  IN_PROGRESS = 'in-progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum CampaignContactType {
  WHATSAPP = 'whatsapp',
  WLH = 'wlh',
}

// Message Template sub-schema
@Schema({ _id: false })
export class MessageTemplate {
  @Prop({
    type: String,
    required: [true, 'Template name is required'],
    trim: true,
    maxlength: 100,
  })
  templateName: string;

  @Prop({
    type: String,
    required: [true, 'Message body is required'],
    trim: true,
  })
  body: string;
}

// Analytics Summary sub-schema
@Schema({ _id: false })
export class AnalyticsSummary {
  @Prop({
    type: Number,
    default: 0,
    min: 0,
  })
  total: number;

  @Prop({
    type: Number,
    default: 0,
    min: 0,
  })
  sent: number;

  @Prop({
    type: Number,
    default: 0,
    min: 0,
  })
  delivered: number;

  @Prop({
    type: Number,
    default: 0,
    min: 0,
  })
  read: number;

  @Prop({
    type: Number,
    default: 0,
    min: 0,
  })
  clicked: number;

  @Prop({
    type: Number,
    default: 0,
    min: 0,
  })
  failed: number;
}

// Stored Campaign Data sub-schema for scheduled campaigns
@Schema({ _id: false })
export class StoredCampaignData {
  @Prop({
    type: [Object],
    required: false,
    default: [],
  })
  contacts: any[]; // Store contact selection data

  @Prop({
    type: String,
    default: 'en_US',
  })
  language: string;

  @Prop({
    type: [VariableMapping],
    default: [],
  })
  variableMappings: VariableMapping[];

  @Prop({
    type: String,
    required: false,
  })
  headerMediaAssetId: string;
}

@Schema({ timestamps: true })
export class Campaign extends Document {
  @Prop({
    type: String,
    required: [true, 'Campaign name is required'],
    trim: true,
    maxlength: 100,
  })
  name: string;

  @Prop({
    type: String,
    enum: Object.values(CampaignContactType),
    default: CampaignContactType.WHATSAPP,
  })
  contactType: CampaignContactType;

  @Prop({
    type: Object,
    required: false,
  })
  wlhAttendeeFilters: any;

  @Prop({
    type: Types.ObjectId,
    ref: User.name,
    required: [true, 'Admin ID is required'],
  })
  adminId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: Project.name,
    required: [true, 'Project ID is required'],
  })
  project: Types.ObjectId;

  @Prop({
    type: MessageTemplate,
    required: [true, 'Message template is required'],
  })
  messageTemplate: MessageTemplate;

  @Prop({
    type: String,
    enum: Object.values(CampaignStatus),
    default: CampaignStatus.DRAFT,
  })
  status: CampaignStatus;

  @Prop({
    type: Date,
  })
  scheduledAt: Date;

  @Prop({
    type: Date,
  })
  completedAt: Date;

  @Prop({
    type: AnalyticsSummary,
    default: () => ({
      total: 0,
      sent: 0,
      delivered: 0,
      read: 0,
      clicked: 0,
      failed: 0,
    }),
  })
  analyticsSummary: AnalyticsSummary;

  @Prop({
    type: StoredCampaignData,
    required: false,
  })
  storedCampaignData: StoredCampaignData;

  @Prop({
    type: String,
    required: false,
  })
  headerMediaAssetId: string;

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

const CampaignSchema = SchemaFactory.createForClass(Campaign);

// Pre-save middleware to convert string IDs to ObjectIds
CampaignSchema.pre('save', function (next) {
  if (typeof this.project === 'string') {
    this.project = new Types.ObjectId(`${this.project}`);
  }
  if (typeof this.adminId === 'string') {
    this.adminId = new Types.ObjectId(`${this.adminId}`);
  }
  next();
});

// Create indexes for better query performance
CampaignSchema.index({ adminId: 1, project: 1 });
CampaignSchema.index({ status: 1, adminId: 1 });
CampaignSchema.index({ scheduledAt: 1 });
CampaignSchema.index({ createdAt: -1 });

export { CampaignSchema };
