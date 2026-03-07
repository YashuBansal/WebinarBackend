import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from 'src/schemas/User.schema';
import { Project } from 'src/schemas/project.schema';
import { Program } from './program.schema';
import { Attendee } from 'src/schemas/Attendee.schema';

export type ProgramAssignmentDocument = ProgramAssignment & Document;

export enum ProgramAssignmentStatus {
  SCHEDULED = 'scheduled',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum ProgramAssignmentSource {
  MANUAL = 'manual',
  AUTO = 'auto',
}

@Schema({ timestamps: true })
export class ProgramAssignment extends Document {
  @Prop({ type: Types.ObjectId, ref: Program.name, required: true, index: true })
  programId: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    trim: true,
    maxlength: 20,
    index: true,
  })
  phone: string;

  @Prop({ type: Types.ObjectId, ref: Attendee.name, index: true })
  attendeeId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: User.name, required: true, index: true })
  adminId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: Project.name, required: true, index: true })
  projectId: Types.ObjectId;

  @Prop({ type: Date, required: true })
  startAt: Date;

  @Prop({ type: String, required: true }) // IANA timezone
  timezone: string;

  @Prop({
    type: String,
    enum: Object.values(ProgramAssignmentStatus),
    default: ProgramAssignmentStatus.SCHEDULED,
    index: true,
  })
  status: ProgramAssignmentStatus;

  @Prop({ type: Object, default: {} }) // e.g. { name: 'John', email: 'j@x.com' }
  dynamicVariables: Record<string, string>;

  @Prop({ type: Number, default: 0, min: 0 }) // last completed occurrence index (0-based)
  currentOccurrence: number;

  @Prop({ type: Number, default: -1, min: -1 }) // last completed slot index (0-based)
  currentSlotIndex: number;

  @Prop({ type: Date })
  lastProcessedAt: Date;

  @Prop({ type: Date })
  pausedAt: Date;

  @Prop({ type: Date })
  completedAt: Date;

  @Prop({ type: Number, default: 0 })
  failureCount: number;

  @Prop({
    type: String,
    enum: Object.values(ProgramAssignmentSource),
    default: ProgramAssignmentSource.MANUAL,
    index: true,
  })
  source: ProgramAssignmentSource;
}

const ProgramAssignmentSchema = SchemaFactory.createForClass(ProgramAssignment);

ProgramAssignmentSchema.pre('save', function (next) {
  if (typeof this.programId === 'string') {
    this.programId = new Types.ObjectId(this.programId);
  }
  if (typeof this.adminId === 'string') {
    this.adminId = new Types.ObjectId(this.adminId);
  }
  if (typeof this.projectId === 'string') {
    this.projectId = new Types.ObjectId(this.projectId);
  }
  if (this.attendeeId && typeof this.attendeeId === 'string') {
    this.attendeeId = new Types.ObjectId(this.attendeeId);
  }
  next();
});

ProgramAssignmentSchema.index({ programId: 1, phone: 1 }, { unique: true });
ProgramAssignmentSchema.index({ status: 1, startAt: 1 });
ProgramAssignmentSchema.index({ projectId: 1, status: 1 });

export { ProgramAssignmentSchema };
