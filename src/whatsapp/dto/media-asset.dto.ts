import { IsOptional, IsString, IsNumber, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';

export class GetMediaAssetsDto {
  @IsString()
  projectId: string;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class MediaAssetResponseDto {
  _id: string;
  userId: string;
  projectId: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  createdAt: Date;
  updatedAt: Date;
}

export class PaginatedMediaAssetsResponseDto {
  data: MediaAssetResponseDto[];
  total: number;
  page: number;
  limit: number;
}
