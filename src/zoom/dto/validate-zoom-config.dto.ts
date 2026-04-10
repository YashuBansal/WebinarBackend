import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ValidateZoomConfigDto {
  @IsString()
  @IsNotEmpty()
  projectName: string;

  @IsString()
  @IsNotEmpty()
  accountId: string;

  @IsString()
  @IsNotEmpty()
  clientId: string;

  @IsString()
  @IsNotEmpty()
  clientSecret: string;

  @IsString()
  @IsOptional()
  secretToken?: string;
}
