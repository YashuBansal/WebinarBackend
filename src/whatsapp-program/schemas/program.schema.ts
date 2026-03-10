import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from 'src/schemas/User.schema';
import { Project } from 'src/schemas/project.schema';
import { VariableMapping } from 'src/webinar-auto-message/webinar-auto-message.schema';

export type ProgramDocument = Program & Document;

export enum IntervalUnit {
  DAY = 'day',
  WEEK = 'week',
}

export enum ProgramMessageType {
  TEMPLATE = 'template',
  SESSION = 'session',
}

@Schema({ _id: false })
export class ProgramMessageConfig {
  @Prop({ type: String, enum: Object.values(ProgramMessageType), default: ProgramMessageType.TEMPLATE })
  messageType: ProgramMessageType;

  @Prop({ type: String, required: true })
  templateName: string;

  @Prop({ type: String, default: 'en_US' })
  language?: string;

  @Prop({ type: [VariableMapping], default: [] })
  variableMappings: VariableMapping[];

  @Prop({ type: String })
  headerMediaAssetId?: string;
}

@Schema({ _id: false })
export class ProgramTimeSlot {
  @Prop({ type: String, required: true }) // HH:mm
  time: string;

  @Prop({ type: String, required: true }) // IANA timezone e.g. Asia/Kolkata
  timezone: string;

  @Prop({ type: ProgramMessageConfig, required: true })
  messageConfig: ProgramMessageConfig;
}

const ProgramTimeSlotSchema = SchemaFactory.createForClass(ProgramTimeSlot);

@Schema({ timestamps: true })
export class Program extends Document {
  @Prop({
    type: String,
    required: true,
    trim: true,
    maxlength: 100,
  })
  name: string;

  @Prop({ type: Types.ObjectId, ref: User.name, required: true, index: true })
  adminId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: Project.name, required: true, index: true })
  projectId: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 1 }) // e.g. 5 days, 10 cycles
  occurrenceCount: number;

  @Prop({
    type: String,
    enum: Object.values(IntervalUnit),
    required: true,
  })
  intervalUnit: IntervalUnit;

  @Prop({ type: Number, required: true, min: 1 })
  intervalValue: number;

  /** When intervalUnit is 'week', optional list of weekdays 1-7 (1=Mon .. 7=Sun). If present, total occurrences = occurrenceCount * weekdays.length. If absent, single weekday from intervalValue. */
  @Prop({ type: [Number], default: undefined })
  weekdays?: number[];

  /** occurrenceTimeSlots[i] = time slots for occurrence i+1; each occurrence can have 0 or more slots */
  @Prop({ type: [[ProgramTimeSlotSchema]], default: [] })
  occurrenceTimeSlots: ProgramTimeSlot[][];

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: Boolean, default: false })
  isAutoAssignable: boolean;

  @Prop({ type: Object, default: null })
  autoAssignCriteria?: any;

  @Prop({ type: Boolean, default: false })
  isDeleted: boolean;
}

const ProgramSchema = SchemaFactory.createForClass(Program);

ProgramSchema.pre('save', function (next) {
  if (typeof this.adminId === 'string') {
    this.adminId = new Types.ObjectId(this.adminId);
  }
  if (typeof this.projectId === 'string') {
    this.projectId = new Types.ObjectId(this.projectId);
  }
  next();
});

ProgramSchema.index({ adminId: 1, projectId: 1 });
ProgramSchema.index({ isDeleted: 1, isActive: 1 });
/** At most one non-deleted program per admin with a given name */
ProgramSchema.index(
  { adminId: 1, name: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);

export { ProgramSchema };
