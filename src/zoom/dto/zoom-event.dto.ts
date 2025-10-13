//class-validator dto for zoom event
import { IsString, IsNotEmpty, IsEnum, IsObject, IsOptional } from 'class-validator';
import { ZoomMeetingEventType } from '../schemas/zoom-meeting-event.schema';

export class ZoomEventDto {

    @IsOptional()
    @IsString()
    accountId: string;

    @IsString()
    @IsNotEmpty()
    meetingId: string;
    
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