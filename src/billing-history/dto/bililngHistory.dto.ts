import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsDateString,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { DurationType } from 'src/schemas/BillingHistory.schema';

export class BillingHistoryDto {
  @IsObject()
  @IsNotEmpty()
  admin: string;

  @IsOptional()
  @IsDate()
  startDate?: Date;

  @IsOptional()
  @IsDate()
  expiryDate?: Date;

  @IsString()
  @IsNotEmpty()
  plan: string;

  @IsNumber()
  @IsNotEmpty()
  amount: number;

  @IsNumber()
  @IsNotEmpty()
  itemAmount: number;

  @IsNumber()
  @IsNotEmpty()
  taxPercent: number;

  @IsNumber()
  @IsNotEmpty()
  taxAmount: number;

  @IsNumber()
  @IsNotEmpty()
  discountAmount: number;

  @IsEnum(DurationType, {
    message: 'Duration type must be one of the allowed values.',
  })
  durationType: DurationType;
}

export class UpdateBillingHistory extends PartialType(BillingHistoryDto) {}

export class GetBillingHistoryDto {
  @IsOptional()
  @IsMongoId()
  adminId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit: number;
}

export class ExportBillingHistoryDTO {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsString()
  @IsNotEmpty()
  fileName: string;
}
