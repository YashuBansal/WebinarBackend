import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { RangeStringDto } from 'src/users/dto/filters.dto';

export class CreateProductsDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @IsNotEmpty()
  price: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  adminId: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  webinar: string;

  @IsString()
  @IsNotEmpty()
  description: string; //description

  @IsNumber()
  @IsNotEmpty()
  level: number;

  @IsOptional()
  @IsString()
  tag: string;
}

export class ProductsFilterDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  uniqueId?: string;

  @IsOptional()
  @IsNumber()
  price?: RangeStringDto;

  @IsOptional()
  @IsNumber()
  level?: string;

  @IsOptional()
  @IsString()
  tag?: string;
}

export class UpdateProductsDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsNumber()
  @IsNotEmpty()
  price?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  webinar?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  description?: string; //description

  @IsOptional()
  @IsNumber()
  @IsNotEmpty()
  level?: number;

  @IsOptional()
  @IsString()
  tag?: string;
}
