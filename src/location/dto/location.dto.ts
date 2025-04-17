import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

export class CreateLocationDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  state: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  previousName?: string;

  @IsOptional()
  @IsBoolean()
  @IsNotEmpty()
  isVerified: boolean;

  @IsOptional()
  @IsBoolean()
  @IsNotEmpty()
  isAdminVerified: boolean;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  employee?: string;

  @ValidateIf((o) => o.employee)
  @IsString()
  @IsNotEmpty()
  admin?: string;

  @IsOptional()
  color?: any;
}

export class CreateLoationsDto {
  @IsArray()
  @IsString({ each: true })
  locations: string[];
}

export class UpdateLocationDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsBoolean()
  @IsNotEmpty()
  isVerified?: boolean;

  @IsOptional()
  @IsBoolean()
  @IsNotEmpty()
  isAdminVerified?: boolean;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  note?: string;

  
}

export class AdminVerificationDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  previousName?: string;

  @IsOptional()
  @IsBoolean()
  @IsNotEmpty()
  isAdminVerified?: boolean;
}
