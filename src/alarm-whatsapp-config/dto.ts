import {
  IsArray,
  IsBoolean,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class VariableMappingDto {
  @IsString()
  @IsNotEmpty()
  variable: string;

  @IsBoolean()
  isDynamic: boolean;

  @ValidateIf((o) => o.isDynamic === true)
  @IsString()
  @IsNotEmpty()
  contactField?: string;

  @ValidateIf((o) => o.isDynamic === false)
  @IsString()
  @IsNotEmpty()
  staticValue?: string;

  @ValidateIf((o) => o.isDynamic === true)
  @IsString()
  @IsNotEmpty()
  fallbackValue?: string;
}

export class UpsertAlarmWhatsappConfigDto {
  @IsMongoId()
  @IsNotEmpty()
  projectId: string;

  @IsString()
  @IsNotEmpty()
  mainAlarmTemplateName: string;

  @IsOptional()
  @IsString()
  mainAlarmLanguage?: string;

  @IsOptional()
  @IsString()
  mainAlarmHeaderMediaAssetId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariableMappingDto)
  mainAlarmVariableMappings: VariableMappingDto[];

  @IsString()
  @IsNotEmpty()
  reminder15mTemplateName: string;

  @IsOptional()
  @IsString()
  reminder15mLanguage?: string;

  @IsOptional()
  @IsString()
  reminder15mHeaderMediaAssetId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariableMappingDto)
  reminder15mVariableMappings: VariableMappingDto[];

  @IsString()
  @IsNotEmpty()
  reminder30mTemplateName: string;

  @IsOptional()
  @IsString()
  reminder30mLanguage?: string;

  @IsOptional()
  @IsString()
  reminder30mHeaderMediaAssetId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariableMappingDto)
  reminder30mVariableMappings: VariableMappingDto[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class GetAlarmWhatsappConfigQueryDto {
  @IsMongoId()
  @IsNotEmpty()
  projectId: string;
}

export class TestSendAlarmWhatsappConfigDto {
  @IsMongoId()
  @IsNotEmpty()
  projectId: string;

  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @IsString()
  @IsNotEmpty()
  type: 'main' | 'reminder15m' | 'reminder30m';
}

export class DeleteAlarmWhatsappConfigDto {
  @IsMongoId()
  @IsNotEmpty()
  _id: string;
}

export class ToggleAlarmWhatsappConfigDto {
  @IsMongoId()
  @IsNotEmpty()
  _id: string;

  @IsBoolean()
  @IsNotEmpty()
  enabled: boolean;
}
