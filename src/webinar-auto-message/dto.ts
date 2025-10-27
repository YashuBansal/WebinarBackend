import { IsArray, IsBoolean, IsMongoId, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class VariableMappingDto {
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

export class UpsertAutoMessageDto {
  @IsMongoId()
  @IsNotEmpty()
  projectId: string;

  @IsMongoId()
  @IsNotEmpty()
  webinarId: string;

  @IsString()
  @IsNotEmpty()
  templateName: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  headerMediaAssetId?: string;

  @IsBoolean()
  enabled: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariableMappingDto)
  variableMappings: VariableMappingDto[];
}

export class GetConfigQueryDto {
  @IsMongoId()
  @IsNotEmpty()
  projectId: string;

  @IsMongoId()
  @IsNotEmpty()
  webinarId: string;
}

export class TestSendDto {
  @IsMongoId()
  @IsNotEmpty()
  projectId: string;

  @IsMongoId()
  @IsNotEmpty()
  webinarId: string;

  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @IsString()
  @IsNotEmpty()
  templateName: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  headerMediaAssetId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariableMappingDto)
  variableMappings: VariableMappingDto[];
}

export class DeleteAutoMessageDto {
  @IsMongoId()
  @IsNotEmpty()
  webinarId: string;

  @IsMongoId()
  @IsNotEmpty()
  projectId: string;
}


