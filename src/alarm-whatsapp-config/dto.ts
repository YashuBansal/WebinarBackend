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
  reminderTemplateName: string;

  @IsOptional()
  @IsString()
  reminderLanguage?: string;

  @IsOptional()
  @IsString()
  reminderHeaderMediaAssetId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariableMappingDto)
  reminderVariableMappings: VariableMappingDto[];

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
  type: 'main' | 'reminder';
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
