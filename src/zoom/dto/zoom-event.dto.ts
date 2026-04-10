//class-validator dto for zoom event
import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsObject,
  IsOptional,
  IsMongoId,
} from 'class-validator';
import { ZoomMeetingEventType } from '../schemas/zoom-meeting-event.schema';
import { Types } from 'mongoose';

export class ZoomEventDto {
  @IsMongoId()
  projectId: Types.ObjectId;

  @IsOptional()
  @IsString()
  accountId: string;

  @IsString()
  @IsNotEmpty()
  meetingId: string;

  @IsOptional()
  @IsString()
  occurrenceId?: string;

  @IsEnum(ZoomMeetingEventType)
  @IsNotEmpty()
  eventType: ZoomMeetingEventType;

  @IsOptional()
  @IsString()
  participantId: string;

  @IsOptional()
  @IsString()
  participantUserId: string;

  @IsOptional()
  @IsString()
  participantName: string;

  @IsOptional()
  @IsString()
  participantEmail: string;

  @IsObject()
  @IsOptional()
  raw: Record<string, any>;
}
