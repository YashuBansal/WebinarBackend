import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Project } from 'src/schemas/project.schema';
import { User } from 'src/schemas/User.schema';
import { ConfiguredTemplate } from 'src/configured-templates/schema/configured-template.schema';

@Schema({ _id: false })
export class NotificationSetting {

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
    })
    delayInSeconds: number;

    @Prop({
        type: Types.ObjectId,
        ref: ConfiguredTemplate.name,
        required: false,
    })
    configuredTemplateId?: Types.ObjectId;
}

@Schema({ timestamps: true })
export class ZoomMeeting {
    _id: Types.ObjectId;

    @Prop({
        type: String,
        required: true,
    })
    meetingId: string;

    @Prop({
        type: String,
        required: true,
    })
    topic: string;

    @Prop({
        type: Types.ObjectId,
        ref: User.name,
        required: [true, 'Admin ID is required'],
    })
    adminId: Types.ObjectId;

    @Prop({
        type: Types.ObjectId,
        ref: Project.name,
        required: [true, 'Project ID is required'],
    })
    project: Types.ObjectId;

    @Prop({
        type: NotificationSetting,
        required: true,
    })
    meetingStarted: NotificationSetting;

    @Prop({
        type: NotificationSetting,
        required: true,
    })
    nonAttendeeNudge: NotificationSetting;


    @Prop({
        type: NotificationSetting,
        required: true,
    })
    participantLeft: NotificationSetting;


    @Prop({
        type: NotificationSetting,
        required: true,
    })
    meetingEndedAttendees: NotificationSetting;

    @Prop({
        type: NotificationSetting,
        required: true,
    })
    meetingEndedNonAttendees: NotificationSetting;

    @Prop({ type: Date, required: false })
    startTime?: Date;

    @Prop({ type: Date, required: false })
    endTime?: Date;

}



export type ZoomMeetingDocument = HydratedDocument<ZoomMeeting>;
export const ZoomMeetingSchema = SchemaFactory.createForClass(ZoomMeeting);


