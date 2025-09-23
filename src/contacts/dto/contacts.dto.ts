import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsString,
  IsEmail,
  IsOptional,
  IsArray,
  IsBoolean,
  IsMongoId,
  MinLength,
  MaxLength,
  ArrayMaxSize,
} from 'class-validator';

export class CreateContactDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(100)
  readonly firstName: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  readonly lastName?: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(20)
  readonly phone: string;

  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty()
  @MaxLength(255)
  readonly email: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  @ArrayMaxSize(10, { message: 'Maximum 10 tags allowed' })
  readonly tags?: string[];

  @IsMongoId()
  @IsNotEmpty()
  readonly projectId: string;
}

export class UpdateContactDto {
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(100)
  readonly firstName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  readonly lastName?: string;

  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(20)
  readonly phone?: string;

  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsOptional()
  @MaxLength(255)
  readonly email?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  @ArrayMaxSize(10, { message: 'Maximum 10 tags allowed' })
  readonly tags?: string[];

  @IsBoolean()
  @IsOptional()
  readonly isActive?: boolean;
}

export class BulkCreateContactsDto {
  @IsArray()
  @Type(() => CreateContactDto)
  readonly contacts: CreateContactDto[];
}

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit: number = 10;
}

export class ContactFiltersDto {
  @IsOptional()
  @IsString()
  readonly search?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  readonly tags?: string[];

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  readonly isActive?: boolean;

  @IsOptional()
  @IsMongoId()
  readonly projectId?: string;
}
