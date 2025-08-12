import {
  IsArray,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

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
