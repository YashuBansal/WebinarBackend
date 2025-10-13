import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Project } from 'src/schemas/project.schema';
import { User } from 'src/schemas/User.schema';
import { Webinar } from 'src/schemas/Webinar.schema';

@Schema({ _id: false })
export class MeetingEventConfig {
  @Prop({
    type: Boolean,
    required: true,
    default: false,
  })
  enabled: boolean;

  @Prop({
    type: Number,
    required: true,
    default: 0,
    min: 0,
    max: 60, // Max 60 minutes delay
  })
  delayInMinutes: number;

  @Prop({
    type: Types.ObjectId,
    ref: 'ConfiguredTemplate',
    required: false,
  })
  configuredTemplateId?: Types.ObjectId;
}

@Schema({ timestamps: true })
export class MeetingEventConfiguration {
  _id: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    unique: true,
  })
  meetingId: string;

  @Prop({
    type: Types.ObjectId,
    ref: User.name,
    required: [true, 'Admin ID is required'],
  })
  adminId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: Webinar.name,
    required: false,
  })
  webinarId?: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'Project',
    required: true,
  })
  whatsappProjectId: Types.ObjectId;

  @Prop({
    type: MeetingEventConfig,
    required: true,
  })
  meetingStarted: MeetingEventConfig;

  @Prop({
    type: MeetingEventConfig,
    required: true,
  })
  nonAttendeeNudge: MeetingEventConfig;

  @Prop({
    type: MeetingEventConfig,
    required: true,
  })
  participantLeft: MeetingEventConfig;

  @Prop({
    type: MeetingEventConfig,
    required: true,
  })
  meetingEndedAttendees: MeetingEventConfig;

  @Prop({
    type: MeetingEventConfig,
    required: true,
  })
  meetingEndedNonAttendees: MeetingEventConfig;
}

export type MeetingEventConfigurationDocument = HydratedDocument<MeetingEventConfiguration>;
export const MeetingEventConfigurationSchema = SchemaFactory.createForClass(MeetingEventConfiguration);
