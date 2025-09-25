import {
  IsString,
  IsNotEmpty,
  IsNumber,
  Min,
  IsOptional,
  IsDateString,
} from 'class-validator';

export class CreateProductLevelDto {
  @IsString()
  @IsNotEmpty()
  label: string;

  @IsNumber()
  @Min(0)
  @IsNotEmpty()
  level: number;
}

export class ProductRevenueExportDTO {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsString()
  @IsNotEmpty()
  fileName: string;

  @IsNumber()
  limit: number;

  @IsString()
  @IsNotEmpty()
  uniqueId: string;
}

export class UpdateProductLevelDto {
  @IsString()
  @IsOptional()
  label?: string;

  //   @IsNumber()
  //   @Min(0)
  //   @IsOptional()
  //   level?: number;
}
