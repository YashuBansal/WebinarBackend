import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  ValidateNested,
  IsBoolean,
  MaxLength,
  IsMongoId,
} from 'class-validator';
import { Type } from 'class-transformer';

// Variable Mapping DTO
export class VariableMappingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100, { message: 'Variable name must not exceed 100 characters' })
  variable: string;

  @IsOptional()
  @IsString()
  dynamicField?: string;

  @IsBoolean()
  @IsNotEmpty()
  isDynamic: boolean;

  @IsOptional()
  @IsString()
  fallbackValue?: string;

  @IsOptional()
  @IsString()
  staticValue?: string;
}

// Create Configured Template DTO
export class CreateConfiguredTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100, { message: 'Template name must not exceed 100 characters' })
  templateName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100, { message: 'Configured template name must not exceed 100 characters' })
  configuredTemplateName: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariableMappingDto)
  variableMappings: VariableMappingDto[];

  @IsOptional()
  @IsMongoId()
  headerMediaAssetId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// Update Configured Template DTO
export class UpdateConfiguredTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Configured template name must not exceed 100 characters' })
  configuredTemplateName?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariableMappingDto)
  variableMappings?: VariableMappingDto[];

  @IsOptional()
  @IsMongoId()
  headerMediaAssetId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// Get Configured Templates Query DTO
export class GetConfiguredTemplatesQueryDto {
  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// Configured Template Response DTO
export class ConfiguredTemplateResponseDto {
  @IsString()
  _id: string;

  @IsString()
  templateName: string;

  @IsString()
  configuredTemplateName: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariableMappingDto)
  variableMappings: VariableMappingDto[];

  @IsOptional()
  @IsString()
  headerMediaAssetId?: string;

  @IsBoolean()
  isActive: boolean;

  @IsBoolean()
  isDeleted: boolean;

  @IsString()
  createdAt: string;

  @IsString()
  updatedAt: string;
}
