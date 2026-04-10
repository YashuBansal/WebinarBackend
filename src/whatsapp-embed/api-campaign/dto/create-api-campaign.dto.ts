import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  ValidateNested,
  IsArray,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class MessageTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  templateName: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  bodyVariables?: string[];

  @IsOptional()
  @IsString()
  headerMediaAssetId?: string;
}

export class CreateApiCampaignDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsString()
  @IsNotEmpty()
  projectId: string;

  @IsObject()
  @ValidateNested()
  @Type(() => MessageTemplateDto)
  messageTemplate: MessageTemplateDto;

  @IsOptional()
  isActive?: boolean;
}
