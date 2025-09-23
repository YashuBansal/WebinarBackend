import { Type } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsMongoId,
  MinLength,
  MaxLength,
} from 'class-validator';

export class CreateWabaTagDto {
  @IsString()
  @IsNotEmpty({ message: 'Tag name is required' })
  @MinLength(1, { message: 'Tag name must be at least 1 character long' })
  @MaxLength(100, { message: 'Tag name must be less than 100 characters' })
  readonly name: string;

  @IsMongoId()
  @IsNotEmpty({ message: 'Project ID is required' })
  readonly projectId: string;
}

export class UpdateWabaTagDto {
  @IsString()
  @IsOptional()
  @MinLength(1, { message: 'Tag name must be at least 1 character long' })
  @MaxLength(100, { message: 'Tag name must be less than 100 characters' })
  readonly name?: string;
}

export class WabaTagFiltersDto {
  @IsOptional()
  @IsString()
  readonly search?: string;

  @IsOptional()
  @IsMongoId()
  readonly projectId?: string;
}
