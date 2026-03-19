import {
  IsNumber,
  Min,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateAddOnDto {
  @IsString()
  @IsNotEmpty()
  addonName: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  employeeLimit: number;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  contactLimit: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  webinarLimit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  whatsappProjectLimit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  zoomProjectLimit?: number;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  addOnPrice: number;

  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  validityInDays: number;
}

export class UpdateAddOnDto {
  @IsNumber()
  @Min(0)
  employeeLimit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  contactLimit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  webinarLimit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  whatsappProjectLimit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  zoomProjectLimit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  addOnPrice?: number;

  @IsOptional()
  @IsNotEmpty()
  @Min(1)
  validityInDays?: number;
}
