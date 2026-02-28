import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Program } from './program.schema';
import { ProgramAssignment } from './program-assignment.schema';
import { WabaMessage } from 'src/whatsapp-embed/waba-message/waba-message.schema';


export enum ProgramSlotStatus {
  PENDING = 'pending',
  ENQUEUED = 'enqueued',
  SKIPPED = 'skipped',
  CANCELLED = 'cancelled',
  PAUSED = 'paused',
}

export type ProgramSlotDocument = ProgramSlot & Document;

@Schema({ timestamps: true })
export class ProgramSlot extends Document {
  @Prop({ type: Types.ObjectId, ref: Program.name, required: true })
  programId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: ProgramAssignment.name, required: true })
  programAssignmentId: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 1 }) // 1-based occurrence index
  occurrenceIndex: number;

  @Prop({ type: Number, required: true, min: 0 }) // 0-based time slot index within the occurrence
  timeSlotIndex: number;

  @Prop({ type: Date, required: true })
  scheduledAt: Date;

  @Prop({
    type: String,
    enum: Object.values(ProgramSlotStatus),
    default: ProgramSlotStatus.PENDING,
    index: true,
  })
  status: ProgramSlotStatus;

  @Prop({ type: String })
  lastError?: string;
}

export const ProgramSlotSchema = SchemaFactory.createForClass(ProgramSlot);

// Core index for scheduler query
ProgramSlotSchema.index({ status: 1, scheduledAt: 1 });
ProgramSlotSchema.index({ programAssignmentId: 1 });
ProgramSlotSchema.index({ programId: 1, occurrenceIndex: 1, timeSlotIndex: 1 });

