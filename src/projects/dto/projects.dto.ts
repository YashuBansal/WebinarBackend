import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsString,
  MinLength,
  IsInt,
  IsOptional,
  Min,
  IsMongoId,
  IsEnum,
} from 'class-validator';
import { WabaMessageType } from 'src/whatsapp-embed/waba-message/waba-message.schema';

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  readonly projectName: string;
}

export class UpdateProjectDto {
  @IsString()
  @MinLength(3)
  @IsOptional()
  readonly projectName?: string;

  @IsString()
  @IsOptional()
  readonly phone?: string;

  // WhatsApp Business Account fields (all optional)
  @IsString()
  @IsOptional()
  readonly appId?: string;

  @IsString()
  @IsOptional()
  readonly appSecret?: string;

  @IsString()
  @IsOptional()
  readonly wabaId?: string;

  @IsString()
  @IsOptional()
  readonly phoneNumberId?: string;

  @IsString()
  @IsOptional()
  readonly permanentAccessToken?: string;
}

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number) // Transform query string to number
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number) // Transform query string to number
  @IsInt()
  @Min(1)
  limit: number = 10;
}

export class CampaignPaginationQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsMongoId()
  campaignId?: string;

  @IsOptional()
  @IsMongoId()
  apiCampaignId?: string;

  @IsOptional()
  @IsString()
  datePreset?: 'today' | 'yesterday' | 'lastWeek' | 'custom';

  @IsOptional()
  @IsString()
  startDate?: string; // ISO date string

  @IsOptional()
  @IsString()
  endDate?: string; // ISO date string

  @IsOptional()
  @IsEnum(WabaMessageType)
  messageType?: WabaMessageType;

  @IsOptional()
  @IsString()
  meetingId?: string;
}
