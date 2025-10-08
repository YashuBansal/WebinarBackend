import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  ValidateNested,
  IsDateString,
  IsEnum,
  IsBoolean,
  IsObject,
  IsNumber,
  IsMongoId,
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

  @IsOptional()
  @IsBoolean()
  isDynamic?: boolean; // Whether to use contact field or static value

  @IsOptional()
  @IsString()
  staticValue?: string; // Static value when not using contact field

  @IsOptional()
  @IsString()
  fallbackValue?: string; // Fallback value when contact field is empty
}

export class ContactSelectionDto {
  @IsString()
  @IsNotEmpty()
  contactId: string;

  @IsString()
  @IsNotEmpty()
  phoneNumber: string;
}

export class WlhAttendeeFiltersFiltersDto {
  @IsMongoId()
  webinarId: string;

  @IsArray()
  @IsString({ each: true })
  tags: string[];
}

export class WlhAttendeeFiltersDto {
  
  @IsObject()
  @ValidateNested()
  @Type(() => WlhAttendeeFiltersFiltersDto)
  filters: WlhAttendeeFiltersFiltersDto;

  @IsNumber()
  contactCount: number;
  
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

  @IsEnum(['whatsapp', 'wlh'])
  @IsNotEmpty()
  contactType: 'whatsapp' | 'wlh';

  @IsOptional()
  @ValidateNested()
  @Type(() => WlhAttendeeFiltersDto)
  wlhAttendeeFilters?: WlhAttendeeFiltersDto;
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
