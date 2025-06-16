import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Types } from 'mongoose';
import {
  AttendeesFilterDto,
  CreateAttendeeDto,
  PreWebinarPostAttendeeDTO,
  WebinarAttendeesSortObject,
} from 'src/attendees/dto/attendees.dto';
import { AssignmentStatus, RecordType } from 'src/schemas/Assignments.schema';

export class AssignmentDto {
  @IsOptional()
  @IsMongoId()
  user?: string;

  @IsMongoId()
  webinar: string;

  @IsArray()
  @IsNotEmpty()
  @IsMongoId({ each: true })
  attendees: string[];

  @IsString()
  @IsNotEmpty()
  recordType: 'preWebinar' | 'postWebinar';

  @IsOptional()
  @IsBoolean()
  forceAssign: boolean;
}

export class preWebinarAssignmentDto {
  @IsMongoId()
  webinar: string; // Must be a valid MongoDB ObjectId

  @IsNotEmpty()
  @ValidateNested()
  @Type(() => PreWebinarPostAttendeeDTO)
  attendee: PreWebinarPostAttendeeDTO;
}

export class GetAssignmentDTO {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AttendeesFilterDto)
  filters: AttendeesFilterDto;

  @IsOptional()
  @IsString()
  validCall?: string;

  @IsOptional()
  @IsMongoId()
  webinarId?: string;

  @IsOptional()
  @IsString()
  validCallFlag?: string;

  @IsEnum(AssignmentStatus, {
    message: 'assignmentStatus must be a valid value',
  })
  assignmentStatus: AssignmentStatus;

  @IsOptional()
  @ValidateNested()
  @Type(() => WebinarAttendeesSortObject)
  sort?: WebinarAttendeesSortObject;
}

export class ExportEmployeeAssignmentDTO {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AttendeesFilterDto)
  filters: AttendeesFilterDto;

  @IsOptional()
  @IsString()
  validCall?: string;

  @IsOptional()
  @IsMongoId()
  webinarId?: string;

  @IsOptional()
  @IsString()
  validCallFlag?: string;

  @IsEnum(AssignmentStatus, {
    message: 'assignmentStatus must be a valid value',
  })
  assignmentStatus: AssignmentStatus;

  @IsOptional()
  @ValidateNested()
  @Type(() => WebinarAttendeesSortObject)
  sort?: WebinarAttendeesSortObject;

  @IsArray()
  @IsString({ each: true })
  columns: string[];

  @IsString()
  @IsNotEmpty()
  fileName: string;
}

export class RequestReAssignmentsDTO {
  @IsArray()
  @IsNotEmpty()
  @IsMongoId({ each: true }) // Validate each item in the array as a MongoID
  assignments: string[];

  @IsArray()
  @IsNotEmpty()
  @IsString({ each: true }) // Validate each item in the array as a MongoID
  attendeeEmails: string[];

  @IsOptional()
  @IsEnum(['approved', 'rejected'])
  status: string;

  @IsOptional()
  @IsMongoId()
  userId?: string;

  @IsOptional()
  @IsMongoId()
  webinarId?: string;

  @IsOptional()
  @IsString()
  requestReason?: string;
}

class AssignmentAttendee {
  @IsMongoId()
  assignmentId: string;

  @IsMongoId()
  attendeeId: string;
}

export class ReAssignmentDTO {
  @IsBoolean()
  isTemp: boolean;

  @IsMongoId()
  employeeId: string;

  @IsEnum(RecordType)
  recordType: RecordType;

  @IsMongoId()
  webinarId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AssignmentAttendee)
  assignments: AssignmentAttendee[];

  @IsOptional()
  @IsBoolean()
  forceAssign?: boolean;
}

export class FetchReAssignmentsDTO {
  @IsMongoId()
  webinarId?: string;

  @IsEnum(RecordType)
  recordType: RecordType;

  @IsEnum(AssignmentStatus)
  status: AssignmentStatus;
}

export class MoveToPullbacksDTO {
  @IsOptional()
  @IsBoolean()
  isTemp: boolean;

  @IsOptional()
  @IsMongoId()
  employeeId: string;

  @IsArray()
  @IsNotEmpty()
  @IsMongoId({ each: true }) // Validate each item in the array as a MongoID
  attendees: string[];

  @IsEnum(RecordType)
  recordType: RecordType;

  @IsMongoId()
  webinarId: string;

  @IsOptional()
  @IsBoolean()
  forceAssign?: boolean;
}

export class DateRangeDto {
  @IsDateString()
  start: string;

  @IsDateString()
  end: string;

  @IsOptional()
  @IsMongoId()
  webinarId: string;

  @IsOptional()
  @IsMongoId()
  employeeId: string;
}
