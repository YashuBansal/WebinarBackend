import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  ValidateNested,
  IsDateString,
  IsEnum,
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

export class VariableMappingDto {
  @IsString()
  @IsNotEmpty()
  variable: string; // e.g., "{{1}}", "{{name}}"

  @IsString()
  @IsNotEmpty()
  contactField: string; // e.g., "firstName", "lastName", "phone"
}

export class ContactSelectionDto {
  @IsString()
  @IsNotEmpty()
  contactId: string;

  @IsString()
  @IsNotEmpty()
  phoneNumber: string;
}

export class CreateCampaignWorkflowDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  projectId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContactSelectionDto)
  selectedContacts: ContactSelectionDto[];

  @IsString()
  @IsNotEmpty()
  templateName: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariableMappingDto)
  @IsOptional()
  variableMappings?: VariableMappingDto[];

  @IsEnum(['now', 'scheduled'])
  @IsNotEmpty()
  sendType: 'now' | 'scheduled';

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  headerMediaAssetId?: string;
}

export class CampaignPreviewDto {
  @IsString()
  @IsNotEmpty()
  campaignId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContactSelectionDto)
  sampleContacts: ContactSelectionDto[];
}
