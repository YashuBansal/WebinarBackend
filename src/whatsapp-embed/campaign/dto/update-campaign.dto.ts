import { PartialType } from '@nestjs/mapped-types';
import { CreateCampaignDto } from './create-campaign.dto';
import { IsOptional, IsString, IsEnum } from 'class-validator';

export class UpdateCampaignDto extends PartialType(CreateCampaignDto) {
  @IsOptional()
  @IsString()
  @IsEnum(['draft', 'in-progress', 'completed', 'failed'])
  status?: string;
}
