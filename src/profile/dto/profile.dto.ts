import {
  IsString,
  IsOptional,
  IsArray,
  IsEmail,
  IsEnum,
  MaxLength,
  ArrayMaxSize,
  IsUrl,
} from 'class-validator';

// Business verticals as per WhatsApp API
export enum BusinessVertical {
  OTHER = 'OTHER',
  AUTO = 'AUTO',
  BEAUTY = 'BEAUTY',
  APPAREL = 'APPAREL',
  EDU = 'EDU',
  ENTERTAIN = 'ENTERTAIN',
  EVENT_PLAN = 'EVENT_PLAN',
  FINANCE = 'FINANCE',
  GROCERY = 'GROCERY',
  GOVT = 'GOVT',
  HOTEL = 'HOTEL',
  HEALTH = 'HEALTH',
  NONPROFIT = 'NONPROFIT',
  PROF_SERVICES = 'PROF_SERVICES',
  RETAIL = 'RETAIL',
  TRAVEL = 'TRAVEL',
  RESTAURANT = 'RESTAURANT',
  ALCOHOL = 'ALCOHOL',
  ONLINE_GAMBLING = 'ONLINE_GAMBLING',
  PHYSICAL_GAMBLING = 'PHYSICAL_GAMBLING',
  OTC_DRUGS = 'OTC_DRUGS',
}

// Display name status values
export enum DisplayNameStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  UNKNOWN = 'UNKNOWN',
}

// Update Business Profile DTO
export class UpdateBusinessProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(139, { message: 'About text must not exceed 139 characters' })
  about?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256, { message: 'Address must not exceed 256 characters' })
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512, { message: 'Description must not exceed 512 characters' })
  description?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @MaxLength(128, { message: 'Email must not exceed 128 characters' })
  email?: string;

  @IsOptional()
  @IsEnum(BusinessVertical, { message: 'Invalid business vertical' })
  vertical?: BusinessVertical;

  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true, message: 'Please provide valid website URLs' })
  @ArrayMaxSize(2, { message: 'Maximum 2 websites allowed' })
  websites?: string[];

  @IsOptional()
  @IsString()
  profilePictureHandle?: string;
}

// Business Profile Response DTO
export class BusinessProfileResponseDto {
  @IsOptional()
  @IsString()
  about?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  profile_picture_url?: string;

  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  websites?: string[];

  @IsOptional()
  @IsEnum(BusinessVertical)
  vertical?: BusinessVertical;
}

// Display Name Status DTO
export class DisplayNameStatusDto {
  @IsEnum(DisplayNameStatus)
  displayNameStatus: DisplayNameStatus;

  @IsString()
  displayPhoneNumber: string;

  @IsString()
  verifiedName: string;

  @IsString()
  qualityRating: string;

  @IsString()
  throughput: string;

}

// Profile Picture Upload DTO
export class ProfilePictureUploadDto {
  @IsString()
  fileName: string;

  @IsString()
  mimeType: string;

  @IsString()
  fileHandle: string;
}
