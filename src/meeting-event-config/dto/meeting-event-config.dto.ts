import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsMongoId,
  Min,
  Max,
} from 'class-validator';

// Meeting Event Configuration DTO
export class MeetingEventConfigDto {
  @IsBoolean()
  @IsNotEmpty()
  enabled: boolean;

  @IsNumber()
  @Min(0)
  @Max(60) // Max 60 minutes delay
  @IsNotEmpty()
  delayInMinutes: number;

  @IsOptional()
  @IsMongoId()
  configuredTemplateId?: string;
}

// Create Meeting Event Configuration DTO
export class CreateMeetingEventConfigDto {
  @IsString()
  @IsNotEmpty()
  meetingId: string;

  @IsMongoId()
  @IsNotEmpty()
  whatsappProjectId: string;

  @IsOptional()
  @IsMongoId()
  webinarId?: string;

  @IsNotEmpty()
  meetingStarted: MeetingEventConfigDto;

  @IsNotEmpty()
  nonAttendeeNudge: MeetingEventConfigDto;

  @IsNotEmpty()
  participantLeft: MeetingEventConfigDto;

  @IsNotEmpty()
  meetingEndedAttendees: MeetingEventConfigDto;

  @IsNotEmpty()
  meetingEndedNonAttendees: MeetingEventConfigDto;
}

// Update Meeting Event Configuration DTO
export class UpdateMeetingEventConfigDto {
  @IsOptional()
  @IsMongoId()
  whatsappProjectId?: string;

  @IsOptional()
  @IsMongoId()
  webinarId?: string;

  @IsOptional()
  meetingStarted?: MeetingEventConfigDto;

  @IsOptional()
  nonAttendeeNudge?: MeetingEventConfigDto;

  @IsOptional()
  participantLeft?: MeetingEventConfigDto;

  @IsOptional()
  meetingEndedAttendees?: MeetingEventConfigDto;

  @IsOptional()
  meetingEndedNonAttendees?: MeetingEventConfigDto;
}

// Meeting Event Configuration Response DTO
export class MeetingEventConfigResponseDto {
  @IsString()
  _id: string;

  @IsString()
  meetingId: string;

  @IsString()
  whatsappProjectId: string;

  @IsNotEmpty()
  meetingStarted: MeetingEventConfigDto;

  @IsNotEmpty()
  nonAttendeeNudge: MeetingEventConfigDto;

  @IsNotEmpty()
  participantLeft: MeetingEventConfigDto;

  @IsNotEmpty()
  meetingEndedAttendees: MeetingEventConfigDto;

  @IsNotEmpty()
  meetingEndedNonAttendees: MeetingEventConfigDto;

  @IsString()
  createdAt: string;

  @IsString()
  updatedAt: string;
}
