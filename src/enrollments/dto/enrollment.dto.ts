import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { AttendeesFilterDto } from 'src/attendees/dto/attendees.dto';

export class CreateEnrollmentDto {
  @IsString()
  @IsNotEmpty()
  attendee: string;

  @IsString()
  @IsNotEmpty()
  webinar: string;

  @IsString()
  @IsNotEmpty()
  product: string;

  @IsOptional()
  @IsString()
  createdBy?: string;

  @IsOptional()
  @IsString()
  webinarName?: string;

  @IsOptional()
  @IsString()
  productName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  adminId: string;
}

export class ExportEnrollmentDTO {
  @IsOptional()
  @IsString()
  product?: string;

  @IsArray()
  @IsString({ each: true })
  columns: string[];

  @IsMongoId()
  webinarId: string;

  @IsString()
  @IsNotEmpty()
  fileName: string;
}

export class UpdateEnrollmentDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  product?: string;
}

export class GetEnrollmentsByProductLevelDto {
  @IsString()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  productLevel: string;
}
export class GetEnrollmentsByEmailDto {
  @IsString()
  @IsNotEmpty()
  email: string;
}

export class EnrollmentsByLevelOrProductDTO {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  productLevel?: string;

  @IsOptional()
  @IsMongoId()
  productId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  page?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  limit?: string;
}

export class BulkWebinarEnrollmentDto {
  @IsMongoId()
  @IsNotEmpty()
  webinarId: string;

  @IsMongoId()
  @IsNotEmpty()
  productId: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(['selected', 'filtered'])
  scope: 'selected' | 'filtered';

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  attendeeIds?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => AttendeesFilterDto)
  filters?: AttendeesFilterDto;

  @IsOptional()
  @IsString()
  validCall?: string;

  @IsOptional()
  @IsString()
  assignmentType?: string;

  @IsBoolean()
  isAttended: boolean;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: 'confirmationCode must be exactly 6 digits' })
  confirmationCode: string;
}
