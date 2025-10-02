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
  @IsOptional()
  @MaxLength(100)
  readonly firstName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  readonly lastName?: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(20)
  readonly phone: string;

  @IsOptional()
  @IsString()
  readonly email?: string;

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
  @IsOptional()
  @IsString()
  readonly firstName?: string;

  @IsOptional()
  @IsString()
  readonly lastName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  readonly phone?: string;

  @IsOptional()
  @IsString()
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

  @IsString()
  @IsOptional()
  readonly defaultCountryCode?: string;

  @IsBoolean()
  @IsOptional()
  readonly replaceTags?: boolean;
}

export class CSVImportDto {
  @IsArray()
  @Type(() => CreateContactDto)
  readonly contacts: CreateContactDto[];

  @IsString()
  @IsOptional()
  readonly defaultCountryCode?: string;

  @IsBoolean()
  @IsOptional()
  readonly replaceTags?: boolean;
}

export class CSVFieldMappingDto {
  @IsString()
  @IsOptional()
  readonly firstName?: string;

  @IsString()
  @IsOptional()
  readonly lastName?: string;

  @IsString()
  @IsNotEmpty()
  readonly phone: string;

  @IsString()
  @IsOptional()
  readonly email?: string;

  @IsString()
  @IsOptional()
  readonly tags?: string;
}

export class CSVImportRequestDto {
  @IsString()
  @IsNotEmpty()
  readonly fileName: string;

  @IsArray()
  @Type(() => CSVFieldMappingDto)
  readonly fieldMapping: CSVFieldMappingDto;

  @IsString()
  @IsOptional()
  readonly defaultCountryCode?: string;

  @IsBoolean()
  @IsOptional()
  readonly replaceTags?: boolean;

  @IsMongoId()
  @IsNotEmpty()
  readonly projectId: string;
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
