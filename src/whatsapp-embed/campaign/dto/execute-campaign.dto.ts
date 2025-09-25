import {
  IsArray,
  IsString,
  IsNotEmpty,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

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
  bodyVariables?: string[]; // Template variables for personalization

  @IsString()
  @IsOptional()
  language?: string; // Defaults to template's language if not provided

  @IsString()
  @IsOptional()
  headerMediaAssetId?: string; // Media asset ID for header
}
