import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Attendee } from './Attendee.schema';
import { User } from './User.schema';

@Schema({ timestamps: true })
export class Alarm extends Document {
  @Prop({
    type: Types.ObjectId,
    ref: User.name,
    required: [true, 'User id is required'],
  })
  user: Types.ObjectId; //userId

  @Prop({
    type: Types.ObjectId,
    ref: User.name,
    required: [true, 'User id is required'],
  })
  adminId: Types.ObjectId; //userId

  @Prop({
    type: String,
    required: [true, 'Attendee E-Mail is required.'],
  })
  email: string;

  @Prop({
    type: String,
  })
  secondaryNumber: string;

  @Prop({
    type: Types.ObjectId,
    ref: Attendee.name,
    required: [true, 'Attendee ID is required.'],
  })
  attendeeId: Types.ObjectId;

  @Prop({
    type: Date,
    required: [true, 'Alarm Date-Time is required '],
  })
  date: Date; //details

  @Prop({
    type: Boolean,
    default: true,
  })
  isActive: boolean;

  @Prop({
    type: String,
    required: false,
    maxlength: 600,
  })
  note: string;

  @Prop({
    type: [
      {
        reminderType: { type: String, enum: ['30min', '15min'] },
        reminderDate: { type: Date },
        sent: { type: Boolean, default: false },
      },
    ],
  })
  reminders: {
    reminderType: '30min' | '15min';
    reminderDate: Date;
    sent: boolean;
  }[];
}

export const AlarmSchema = SchemaFactory.createForClass(Alarm);

AlarmSchema.index({ user: 1, isActive: 1, date: 1 });

AlarmSchema.index({ 'reminders.reminderDate': 1, 'reminders.sent': 1 });

AlarmSchema.index({ date: 1, isActive: 1 });
AlarmSchema.pre('save', function (next) {
  if (typeof this.user === 'string') {
    this.user = new Types.ObjectId(`${this.user}`);
  }

  if (typeof this.adminId === 'string') {
    this.adminId = new Types.ObjectId(`${this.adminId}`);
  }

  if (typeof this.attendeeId === 'string') {
    this.attendeeId = new Types.ObjectId(`${this.attendeeId}`);
  }
  next();
});
