import { PartialType } from '@nestjs/mapped-types';
import { CreateApiCampaignDto } from './create-api-campaign.dto';
import { IsOptional, IsBoolean } from 'class-validator';

export class UpdateApiCampaignDto extends PartialType(CreateApiCampaignDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

