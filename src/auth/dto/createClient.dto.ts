import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { DurationType } from 'src/schemas/BillingHistory.schema';
import { DateFormat } from 'src/schemas/User.schema';

export class CreateClientDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  companyName: string;

  @IsString()
  @IsNotEmpty()
  userName: string;

  @IsString()
  @IsNotEmpty()
  password: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @Length(13, 13, { message: 'Phone number must be 13 characters long' })
  @Matches(/^\+91\d{10}$/, {
    message: 'Phone number must start with +91 followed by 10 digits',
  })
  phone: string;

  @IsOptional()
  @IsString()
  role: string;

  @IsString()
  @IsNotEmpty()
  plan: string;

  @IsNumber()
  @IsOptional()
  currentPlanExpiry?: number;

  @IsEnum(DurationType, {
    message: 'Duration type must be one of the allowed values.',
  })
  durationType: DurationType;

  @IsOptional()
  @IsEnum(DateFormat, {
    message: 'Date format must be one of the allowed values.',
  })
  dateFormat: DateFormat;
}

export class ValidateOtpDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  otp: string;
}
