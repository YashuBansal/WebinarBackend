import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ _id: false })
export class ZoomMeetingOccurrence {
  @Prop({ type: String })
  start_time: string;

  @Prop({ type: String })
  occurrence_id: string;

  @Prop({ type: String })
  status: string;

  @Prop({ type: Number })
  duration: number;

  @Prop({ type: Object })
  raw: Record<string, any>;
}

@Schema({ timestamps: true })
export class ZoomMeeting {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, index: true })
  id: string;

  @Prop({ type: String })
  topic: string;

  @Prop({ type: Number })
  duration?: number;

  @Prop({ type: String })
  start_time?: string;

  @Prop({ type: String })
  join_url?: string;

  @Prop({ type: String })
  timezone?: string;

  @Prop({ type: String })
  status?: string;

  // Zoom occurrence id for recurring meetings/webinars (optional)
  @Prop({ type: [ZoomMeetingOccurrence] })
  occurrences?: ZoomMeetingOccurrence[];

  @Prop({ type: Object })
  raw?: Record<string, any>;
  
  @Prop({ type: Boolean, default: false })
  isWebinar?: boolean;
}

export type ZoomMeetingDocument = HydratedDocument<ZoomMeeting>;
export const ZoomMeetingSchema = SchemaFactory.createForClass(ZoomMeeting);
