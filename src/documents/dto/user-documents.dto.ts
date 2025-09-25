import {
  IsMongoId,
  IsString,
  IsNumber,
  IsDateString,
  IsOptional,
  IsObject,
  IsNotEmpty,
  Min,
} from 'class-validator';

export class CreateUserDocumentDto {
  @IsMongoId()
  userId: string;

  @IsString()
  @IsNotEmpty()
  fileName: string;

  @IsString()
  @IsNotEmpty()
  filePath: string;

  @IsNumber()
  @Min(0, { message: 'File size must be greater than 0' })
  fileSize: number;

  @IsOptional()
  @IsNumber()
  downloadCount?: number;

  @IsOptional()
  @IsDateString()
  expiresAt?: Date;

  @IsOptional()
  @IsObject()
  filters?: Record<string, any>;
}

export interface UserDocumentResponse {
  filePath: string;
  fileSize: number;
  success: boolean;
}
