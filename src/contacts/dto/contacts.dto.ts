import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsArray,
  IsBoolean,
  IsMongoId,
  MinLength,
  MaxLength,
  ArrayMaxSize,
  IsIn,
  IsInt,
  Min,
  ValidateNested,
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

  @IsOptional()
  @IsString()
  @IsIn(['csv', 'xlsx', 'unknown'])
  readonly sourceType?: 'csv' | 'xlsx' | 'unknown';

  @IsOptional()
  @IsString()
  readonly fileName?: string;

  @IsOptional()
  @Type(() => Number)
  readonly totalRows?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  readonly clientInvalidRows?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvalidContactRecordSampleDto)
  readonly clientInvalidRecordsSample?: InvalidContactRecordSampleDto[];
}

export class InvalidContactRecordSampleDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly rowNumber: number;

  @IsOptional()
  @IsString()
  readonly phoneRaw?: string;

  @IsString()
  @IsNotEmpty()
  readonly reason: string;

  @IsOptional()
  readonly sourceRow?: Record<string, unknown>;
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
  @IsString()
  readonly firstName?: string;

  @IsOptional()
  @IsString()
  readonly lastName?: string;

  @IsOptional()
  @IsString()
  readonly email?: string;

  @IsOptional()
  @IsString()
  readonly phone?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  readonly tags?: string[];

  @IsOptional()
  @IsString()
  @IsIn(['has_any', 'not_has_any'])
  readonly tagFilterMode?: 'has_any' | 'not_has_any';

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  readonly isActive?: boolean;

  @IsOptional()
  @IsMongoId()
  readonly projectId?: string;
}

export class ImportHistoryQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsMongoId()
  readonly projectId?: string;

  @IsOptional()
  @IsString()
  @IsIn(['queued', 'processing', 'success', 'failed', 'partial_success'])
  readonly status?:
    | 'queued'
    | 'processing'
    | 'success'
    | 'failed'
    | 'partial_success';
}

export class BulkUpdateContactTagsDto {
  @IsArray()
  @IsMongoId({ each: true })
  @ArrayMaxSize(1000, { message: 'Maximum 1000 contacts allowed per request' })
  readonly contactIds: string[];

  @IsMongoId()
  @IsNotEmpty()
  readonly projectId: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10, { message: 'Maximum 10 tags allowed' })
  readonly tags: string[];

  @IsString()
  @IsIn(['add', 'remove'])
  readonly operation: 'add' | 'remove';
}
