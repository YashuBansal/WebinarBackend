import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ConfiguredTemplate } from 'src/configured-templates/schema/configured-template.schema';
import { Project } from 'src/schemas/project.schema';
import { User } from 'src/schemas/User.schema';
import { Webinar } from 'src/schemas/Webinar.schema';
import { ZoomProject } from 'src/zoom/schemas/zoom-project.schema';

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
    ref: ConfiguredTemplate.name,
    required: false,
  })
  configuredTemplateId?: Types.ObjectId;

  @Prop({
    type: Boolean,
    required: false,
    default: false,
  })
  isExecuted?: boolean;
}

@Schema({ timestamps: true })
export class MeetingEventConfiguration {
  _id: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
  })
  meetingId: string;

  @Prop({
    type: String,
    required: false,
  })
  occurrenceId?: string;

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
    ref: Project.name,
    required: true,
  })
  whatsappProjectId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: ZoomProject.name,
    required: true,
  })
  zoomProjectId: Types.ObjectId;

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

export type MeetingEventConfigurationDocument =
  HydratedDocument<MeetingEventConfiguration>;
export const MeetingEventConfigurationSchema = SchemaFactory.createForClass(
  MeetingEventConfiguration,
);

// Ensure uniqueness per meetingId + occurrenceId pair (occurrenceId optional)
MeetingEventConfigurationSchema.index(
  { meetingId: 1, occurrenceId: 1 },
  { unique: true },
);
