import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsMongoId,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class AttendeeFilterConditionDto {
  @IsEnum(['include', 'exclude'])
  mode: 'include' | 'exclude';

  @IsEnum(['email', 'tags'])
  field: 'email' | 'tags';

  @IsEnum(['equals', 'contains'])
  operator: 'equals' | 'contains';

  @IsArray()
  @IsString({ each: true })
  value: string[];

  @IsOptional()
  @IsEnum(['AND', 'OR'])
  logicOperator?: 'AND' | 'OR';
}

export class GetAttendeeCountDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsMongoId({ each: true })
  webinarIds: string[];

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => AttendeeFilterConditionDto)
  conditions?: AttendeeFilterConditionDto[];
}


