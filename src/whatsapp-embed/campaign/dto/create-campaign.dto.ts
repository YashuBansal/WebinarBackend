import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsObject,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class MessageTemplateDto {
  @IsString()
  @IsNotEmpty()
  templateName: string;

  @IsString()
  @IsNotEmpty()
  body: string;
}

export class CreateCampaignDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  projectId: string;

  @IsObject()
  @ValidateNested()
  @Type(() => MessageTemplateDto)
  messageTemplate: MessageTemplateDto;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}
