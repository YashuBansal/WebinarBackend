import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from './User.schema';

export enum AttendeeAction {
  REGISTERED = 'Registered',
  NOTE = 'Note',
  LEAD_TYPE = 'Lead Type',
  ALARM = 'Alarm',
  ALARM_CANCELLED = 'Alarm Cancelled',
  UPDATE_ATTENDEE = 'Update Attendee',
  Enrollment_CREATED = 'Enrollment Created',
  ADDED = 'Added',
  ASSIGNMENT = 'Assignment',
  REASSIGNMENT_REQUEST = 'Reassignment Request',
  REASSIGNMENT_APPROVED = 'Pullback Approved',
  REASSIGNMENT_REJECTED = 'Reassignment Rejected',
  REASSIGNMENT = 'Reassignment',
  PULLBACK = 'Pullback',
  COlUMN_SWAP = 'Column Swapped',
}

@Schema({ timestamps: true })
export class AttendeeLog extends Document {
  @Prop({ type: String, required: true })
  attendee: string;

  @Prop({ required: true })
  action: string;

  @Prop({
    type: String,
    required: false,
  })
  item: string;

  @Prop({ default: '' })
  details: string;

  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  adminId: Types.ObjectId;
}

export const AttendeeLogSchema = SchemaFactory.createForClass(AttendeeLog);
AttendeeLogSchema.pre('save', function (next) {
  if (typeof this.adminId === 'string') {
    this.adminId = new Types.ObjectId(`${this.adminId}`);
  }
  next();
});

AttendeeLogSchema.index({ adminId: 1 });
