import {
  IsArray,
  IsString,
  IsNotEmpty,
  IsOptional,
  ValidateNested,
  IsEnum,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { WlhAttendeeFiltersDto } from './create-campaign-workflow.dto';

export class CampaignContactDto {
  @IsString()
  @IsNotEmpty()
  contactId: string;

  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @IsString()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;
}

export class ExecuteCampaignDto {
  @IsString()
  @IsNotEmpty()
  campaignId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CampaignContactDto)
  contacts: CampaignContactDto[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  bodyVariables?: string[]; // Template variables for personalization (e.g., ["John Doe", "AB-123"] or ["$firstName", "$email"])

  @IsArray()
  @IsOptional()
  dynamicVariables?: boolean[]; // Track which variables are dynamic (contact fields)

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  fallbackValues?: string[]; // Fallback values for dynamic variables when contact fields are empty

  @IsString()
  @IsOptional()
  language?: string; // Defaults to template's language if not provided

  @IsString()
  @IsOptional()
  headerMediaAssetId?: string; // Media asset ID for header

  @IsEnum(['whatsapp', 'wlh'])
  contactType: 'whatsapp' | 'wlh';

  @IsOptional()
  @ValidateNested()
  @Type(() => WlhAttendeeFiltersDto)
  wlhAttendeeFilters?: WlhAttendeeFiltersDto;
}
