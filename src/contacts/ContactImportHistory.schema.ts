import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from '../schemas/User.schema';
import { Project } from '../schemas/project.schema';

export type ContactImportHistoryDocument = ContactImportHistory & Document;

export type ContactImportStatus =
  | 'processing'
  | 'success'
  | 'failed'
  | 'partial_success'
  | 'queued';

export class InvalidContactRecordSample {
  @Prop({ type: Number, required: true })
  rowNumber: number;

  @Prop({ type: String, default: '' })
  phoneRaw?: string;

  @Prop({ type: String, required: true })
  reason: string;

  @Prop({ type: Object, default: null })
  sourceRow?: Record<string, unknown> | null;
}

@Schema({ timestamps: true })
export class ContactImportHistory extends Document {
  @Prop({
    type: Types.ObjectId,
    ref: User.name,
    required: true,
  })
  adminId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: Project.name,
    required: true,
  })
  projectId: Types.ObjectId;

  @Prop({
    type: String,
    enum: ['csv', 'xlsx', 'unknown'],
    default: 'unknown',
  })
  sourceType: 'csv' | 'xlsx' | 'unknown';

  @Prop({ type: String, default: '' })
  fileName: string;

  @Prop({
    type: String,
    enum: ['queued', 'processing', 'success', 'failed', 'partial_success'],
    default: 'queued',
  })
  status: ContactImportStatus;

  @Prop({ type: Number, default: 0 })
  totalRows: number;

  @Prop({ type: Number, default: 0 })
  validRows: number;

  @Prop({ type: Number, default: 0 })
  invalidRows: number;

  @Prop({ type: Number, default: 0 })
  duplicates: number;

  @Prop({ type: Number, default: 0 })
  newCount: number;

  @Prop({ type: Number, default: 0 })
  updatedCount: number;

  @Prop({ type: Number, default: 0 })
  failedCount: number;

  @Prop({ type: Number, default: 0 })
  processedRows: number;

  @Prop({ type: String, default: '' })
  queueJobId: string;

  @Prop({
    type: [InvalidContactRecordSample],
    default: [],
  })
  invalidRecordsSample: InvalidContactRecordSample[];

  @Prop({ type: Object, default: null })
  importPayload: {
    contacts: any[];
    defaultCountryCode?: string;
    replaceTags?: boolean;
    sourceType?: 'csv' | 'xlsx' | 'unknown';
    fileName?: string;
    totalRows?: number;
    clientInvalidRows?: number;
    clientInvalidRecordsSample?: Array<{
      rowNumber: number;
      phoneRaw?: string;
      reason: string;
      sourceRow?: Record<string, unknown>;
    }>;
  } | null;

  @Prop({ type: Date, default: Date.now })
  startedAt: Date;

  @Prop({ type: Date, default: null })
  completedAt: Date | null;

  @Prop({ type: String, default: '' })
  failureReason: string;
}

export const ContactImportHistorySchema =
  SchemaFactory.createForClass(ContactImportHistory);

ContactImportHistorySchema.index({ adminId: 1, projectId: 1, createdAt: -1 });
ContactImportHistorySchema.index({ adminId: 1, status: 1, createdAt: -1 });
