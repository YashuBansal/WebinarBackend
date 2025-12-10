import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Project } from 'src/schemas/project.schema';
import { User } from 'src/schemas/User.schema';

export type WabaTemplateDocument = WabaTemplate & Document;

export enum WabaTemplateStatus {
  APPROVED = 'APPROVED',
  PENDING = 'PENDING',
  REJECTED = 'REJECTED',
  PAUSED = 'PAUSED',
  DELETED = 'DELETED',
}

export enum WabaTemplateCategory {
  MARKETING = 'MARKETING',
  UTILITY = 'UTILITY',
  AUTHENTICATION = 'AUTHENTICATION',
}

export enum WabaTemplateQuality {
  GREEN = 'GREEN',
  YELLOW = 'YELLOW',
  RED = 'RED',
  UNKNOWN = 'UNKNOWN',
}

// @Schema({ _id: false })
// export class WabaTemplateButton {
//   @Prop({
//     type: String,
//     enum: ['QUICK_REPLY', 'URL', 'PHONE_NUMBER', 'COPY_CODE'],
//     required: true,
//   })
//   type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'COPY_CODE';

//   @Prop({ type: String, required: true, trim: true })
//   text: string;

//   @Prop({ type: String, required: false, trim: true })
//   url?: string;

//   @Prop({ type: String, required: false, trim: true })
//   phone_number?: string;

//   @Prop({ type: String, required: false, trim: true })
//   example?: string;
// }

// @Schema({ _id: false })
// export class WabaTemplateComponent {
//   @Prop({
//     type: String,
//     enum: ['HEADER', 'BODY', 'FOOTER', 'BUTTONS'],
//     required: true,
//   })
//   type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';

//   @Prop({
//     type: String,
//     enum: ['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'NONE'],
//     default: 'TEXT',
//   })
//   format: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'NONE';

//   @Prop({ type: String, trim: true })
//   text?: string;

//   @Prop({ type: [String] })
//   examples?: string[];

//   @Prop({ type: Number })
//   variable_count?: number;

//   @Prop({ type: [Object] })
//   buttons?: any[];
// }

@Schema({ timestamps: true })
export class WabaTemplate extends Document {
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
    required: [true, 'Template name is required'],
    trim: true,
  })
  name: string;

  @Prop({
    type: String,
    required: [true, 'Language is required'],
    trim: true,
  })
  language: string;

  @Prop({
    type: String,
    enum: Object.values(WabaTemplateCategory),
    default: WabaTemplateCategory.MARKETING,
  })
  category: WabaTemplateCategory;

  @Prop({
    type: String,
    enum: Object.values(WabaTemplateStatus),
    default: WabaTemplateStatus.PENDING,
    index: true,
  })
  status: WabaTemplateStatus;

  @Prop({
    type: Object,
  })
  quality_score: any;

  @Prop({ type: String, trim: true })
  id?: string;

  @Prop({ type: String, trim: true })
  namespace?: string;

  @Prop({ type: [Object] })
  components: any[];

  @Prop({ type: Boolean, default: true })
  is_active: boolean;

  @Prop({ type: Boolean, default: false })
  is_deleted: boolean;

  @Prop({ type: Date })
  last_synced_at?: Date;

  @Prop({ type: String, trim: true })
  rejected_reason?: string;

  @Prop({ type: Object, required: false, select: false })
  raw?: any;
}

const WabaTemplateSchema = SchemaFactory.createForClass(WabaTemplate);

// Ensure string ids are converted to ObjectIds when saved via plain payloads
WabaTemplateSchema.pre('save', function (next) {
  if (typeof this.projectId === 'string') {
    this.projectId = new Types.ObjectId(`${this.projectId}`);
  }
  if (typeof this.adminId === 'string') {
    this.adminId = new Types.ObjectId(`${this.adminId}`);
  }
  next();
});

// Uniqueness per project + language to avoid duplicates locally
WabaTemplateSchema.index({ projectId: 1, name: 1, language: 1 }, { unique: true });

// Map field names for backward compatibility and to match Meta API
WabaTemplateSchema.set('toJSON', {
  transform: function (doc, ret) {
    // Keep snake_case as is for Meta API compatibility
    return ret;
  },
});

export { WabaTemplateSchema };
