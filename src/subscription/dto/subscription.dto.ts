import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { DurationType } from 'src/schemas/BillingHistory.schema';

export class SubscriptionDto {
  @IsString()
  @IsNotEmpty()
  admin: string;

  @IsString()
  @IsNotEmpty()
  plan: string;

  @IsNumber()
  @IsOptional()
  contactLimit?: number;

  @IsNumber()
  @IsOptional()
  employeeLimit?: number;

  @IsInt({ message: 'Toggle limit must be an integer value.' })
  @Min(0, { message: 'Toggle limit cannot be less than 0.' })
  @IsNotEmpty({ message: 'Toggle limit is required.' })
  toggleLimit: number;

  @IsNumber()
  @IsOptional()
  expiryDate?: number;
}

export class UpdateSubscriptionDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  plan?: string;

  @IsOptional()
  @IsNumber()
  contactLimit?: number;

  @IsOptional()
  @IsInt({ message: 'Toggle limit must be an integer value.' })
  @Min(0, { message: 'Toggle limit cannot be less than 0.' })
  @IsNotEmpty({ message: 'Toggle limit is required.' })
  toggleLimit?: number;

  @IsOptional()
  @IsNumber()
  expiryDate?: number;
}

export class UpdatePlanDTO {
  @IsNotEmpty()
  @IsEmail()
  @Transform(({ value }) => value?.trim()?.toLowerCase())
  email: string;

  @IsNotEmpty()
  @IsMongoId()
  planId: string;

  @IsEnum(DurationType, {
    message: 'Duration type must be one of the allowed values.',
  })
  durationType: DurationType;
}

export class UpdateExpiryDateDTO {
  @IsNotEmpty()
  @IsMongoId()
  adminId: string;

  @IsNotEmpty()
  @IsDateString()
  expiryDate: string;
}

export class AddAddOnDTO {
  @IsNotEmpty()
  @IsMongoId()
  adminId: string;

  @IsNotEmpty()
  @IsMongoId()
  addonId: string;
}

export class ValidateUserEligibilityDTO {
  @IsNotEmpty()
  @IsMongoId()
  planId: string;

  @IsEnum(DurationType, {
    message: 'Duration type must be one of the allowed values.',
  })
  durationType: DurationType;
}
