import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsMongoId,
  IsDateString,
  IsObject,
  IsEnum
} from 'class-validator';

export class CreateProgramAssignmentDto {
  @IsMongoId()
  @IsNotEmpty()
  programId: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsMongoId()
  @IsNotEmpty()
  projectId: string;

  @IsDateString()
  @IsNotEmpty()
  startAt: string; // ISO date string

  @IsString()
  @IsNotEmpty()
  timezone: string; // IANA e.g. Asia/Kolkata

  @IsOptional()
  @IsObject()
  dynamicVariables?: Record<string, string>;

  @IsOptional()
  @IsEnum(['manual', 'auto'])
  source?: 'manual' | 'auto';

  @IsOptional()
  @IsMongoId()
  attendeeId?: string;
}
