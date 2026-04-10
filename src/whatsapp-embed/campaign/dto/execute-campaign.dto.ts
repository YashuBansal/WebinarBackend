import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

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
}
