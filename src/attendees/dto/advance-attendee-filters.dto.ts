import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsMongoId, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import {
  AdvanceFilterLogicOperator,
  AdvanceFilterMode,
  AdvanceFilterOperator,
  AdvanceFilterFieldType,
} from 'src/schemas/advance-filter.schema';

export class AdvanceFilterUnitDTO {
  @IsEnum(AdvanceFilterMode)
  mode: AdvanceFilterMode;

  @IsEnum(AdvanceFilterOperator)
  operator: AdvanceFilterOperator;

  @IsEnum(AdvanceFilterLogicOperator)
  logicOperator: AdvanceFilterLogicOperator;

  @IsArray()
  @IsString({ each: true })
  value: string[];

  @IsString()
  field: string;

  @IsEnum(AdvanceFilterFieldType)
  fieldType: AdvanceFilterFieldType;

  @IsBoolean()
  isMultiple: boolean;
}

export enum AdvanceFilterResponseType {
  COUNT = 'count',
  DATA = 'data',
}

export class AdvanceFilterDTO {
  @IsEnum(AdvanceFilterResponseType)
  @IsOptional()
  responseType: AdvanceFilterResponseType = AdvanceFilterResponseType.DATA;

  @IsMongoId()
  webinarId: string;

  @IsBoolean()
  isAttended: boolean;

  @IsArray()
  @IsNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => AdvanceFilterUnitDTO)
  units: AdvanceFilterUnitDTO[];
}