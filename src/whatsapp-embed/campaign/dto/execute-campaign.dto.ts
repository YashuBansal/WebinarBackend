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
import { VariableMapping } from 'src/webinar-auto-message/webinar-auto-message.schema';

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
