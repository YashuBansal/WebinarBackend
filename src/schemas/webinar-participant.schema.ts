import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from './User.schema';
import { Webinar } from './Webinar.schema';

@Schema({ timestamps: true })
export class WebinarParticipant extends Document {
  @Prop({
    type: String,
    maxlength: 100,
    required: [true, 'Email is required'],
    trim: true,
    lowercase: true,
  })
  email: string; // E-Mail

  @Prop({
    type: String,
    maxlength: 100,
    trim: true,
    default: null,
  })
  firstName: string | null; // First Name

  @Prop({
    type: String,
    maxlength: 100,
    trim: true,
    default: null,
  })
  lastName: string | null; //Last Name

  // --- NEW FIELDS ADDED HERE ---
  @Prop({ type: Date, default: null })
  inTime: Date | null; // Datetime when the participant joined the session

  @Prop({ type: Date, default: null })
  outTime: Date | null; // Datetime when the participant left the session
  // -----------------------------

  @Prop({
    type: Types.ObjectId,
    ref: Webinar.name,
    required: true,
  })
  webinar: Types.ObjectId; // Webinar Name

  @Prop({
    type: Types.ObjectId,
    ref: User.name,
    required: [true, 'adminId is required'],
  })
  adminId: Types.ObjectId;
}

export const WebinarParticipantSchema =
  SchemaFactory.createForClass(WebinarParticipant);

WebinarParticipantSchema.index({ email: 1 });

WebinarParticipantSchema.index({ adminId: 1, webinar: 1, email: 1 });
