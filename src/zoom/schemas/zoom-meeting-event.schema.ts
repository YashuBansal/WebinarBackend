import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Project } from 'src/schemas/project.schema';

export enum ZoomMeetingEventType {
  ParticipantJoined = 'participant_joined',
  ParticipantLeft = 'participant_left',
  MeetingStarted = 'meeting_started',
  MeetingEnded = 'meeting_ended',
}

@Schema({ timestamps: true })
export class ZoomMeetingEvent {
  _id: Types.ObjectId;

  // Zoom account id associated with the event (from webhook header/body)
  @Prop({ type: String, index: true })
  accountId?: string;

  @Prop({ type: String, required: true, index: true })
  meetingId: string;

  @Prop({
    type: String,
    enum: Object.values(ZoomMeetingEventType),
    required: true,
    index: true,
  })
  eventType: ZoomMeetingEventType;

  @Prop({ type: String })
  participantId?: string;

  @Prop({ type: String })
  participantUserId?: string;

  @Prop({ type: String })
  participantName?: string;

  @Prop({ type: String })
  participantEmail?: string;

  @Prop({ type: Object })
  raw?: Record<string, any>;

  @Prop({ type: Types.ObjectId, ref: Project.name })
  projectId: Types.ObjectId;
}

export type ZoomMeetingEventDocument = HydratedDocument<ZoomMeetingEvent>;
export const ZoomMeetingEventSchema =
  SchemaFactory.createForClass(ZoomMeetingEvent);
ZoomMeetingEventSchema.index({
  projectId: 1,
  accountId: 1,
  meetingId: 1,
  eventType: 1,
  createdAt: -1,
});
