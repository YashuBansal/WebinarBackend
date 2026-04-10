import {
  IsString,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';

export class MediaDto {
  @IsString()
  @IsNotEmpty()
  url: string;

  @IsString()
  @IsNotEmpty()
  filename: string;
}

export class ExecuteApiCampaignDto {
  @IsString()
  @IsNotEmpty()
  campaignName: string;

  @IsString()
  @IsNotEmpty()
  destination: string;

  @ValidateNested()
  @Type(() => MediaDto)
  media: MediaDto;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  templateParams?: string[];
}
