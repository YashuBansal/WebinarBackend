import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { WabaMessageType } from '../waba-message.schema';

export class FindPaginatedWabaMessageDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @Min(1)
  page: number;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @Min(1)
  @Max(200)
  limit: number;

  @IsOptional()
  @IsMongoId()
  projectId?: string;

  @IsOptional()
  @IsMongoId()
  campaignId?: string;

  @IsOptional()
  @IsMongoId()
  contactId?: string;

  @IsOptional()
  @IsEnum(WabaMessageType)
  messageType?: WabaMessageType;

  @IsOptional()
  @IsString()
  templateName?: string;

  @IsOptional()
  @IsString()
  meetingId?: string;

  @IsOptional()
  @IsString()
  occurrenceId?: string;
}
