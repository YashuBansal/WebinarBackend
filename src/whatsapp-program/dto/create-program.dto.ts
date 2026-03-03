import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsArray,
  IsBoolean,
  IsMongoId,
  IsEnum,
  Min,
  Max,
  ValidateNested,
  MaxLength,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ProgramTimeSlotDto {
  @IsString()
  @IsNotEmpty()
  time: string; // HH:mm

  @IsString()
  @IsNotEmpty()
  timezone: string; // IANA e.g. Asia/Kolkata
}

export class ProgramVariableMappingDto {
  @IsString()
  @IsNotEmpty()
  variable: string;

  @IsBoolean()
  isDynamic: boolean;

  @IsOptional()
  @IsString()
  contactField?: string;

  @IsOptional()
  @IsString()
  staticValue?: string;

  @IsOptional()
  @IsString()
  fallbackValue?: string;
}

export class ProgramMessageConfigDto {
  @IsEnum(['template', 'session'])
  messageType: 'template' | 'session';

  @IsString()
  @IsNotEmpty()
  templateName: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProgramVariableMappingDto)
  variableMappings?: ProgramVariableMappingDto[];

  @IsOptional()
  @IsMongoId()
  headerMediaAssetId?: string;
}

export class ProgramTimeSlotWithConfigDto {
  @IsString()
  @IsNotEmpty()
  time: string; // HH:mm

  @IsString()
  @IsNotEmpty()
  timezone: string; // IANA e.g. Asia/Kolkata

  @ValidateNested()
  @Type(() => ProgramMessageConfigDto)
  messageConfig: ProgramMessageConfigDto;
}

export class CreateProgramDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsMongoId()
  @IsNotEmpty()
  projectId: string;

  @IsNumber()
  @Min(1)
  occurrenceCount: number;

  @IsNumber()
  @Min(1)
  intervalValue: number;

  @IsEnum(['day', 'week'])
  intervalUnit: 'day' | 'week';

  /** When intervalUnit is 'week', optional weekdays 1-7 (1=Mon .. 7=Sun). If present, total = occurrenceCount * weekdays.length */
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  weekdays?: number[];

  /** occurrenceTimeSlots[i] = slots for occurrence i+1; length must equal getTotalOccurrenceCount (occurrenceCount or occurrenceCount * weekdays.length when week) */
  @IsArray()
  occurrenceTimeSlots: ProgramTimeSlotWithConfigDto[][];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isAutoAssignable?: boolean;

  @IsOptional()
  @IsObject()
  autoAssignCriteria?: any;
}
