import {
  IsOptional,
  IsString,
  IsDateString,
  IsNotEmpty,
} from 'class-validator';

export class CreateZoomProjectDto {
  @IsNotEmpty()
  @IsString()
  projectName: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  accessToken?: string;

  @IsOptional()
  @IsString()
  refreshToken?: string;

  @IsOptional()
  @IsDateString()
  accessTokenExpiresAt?: Date;
}
