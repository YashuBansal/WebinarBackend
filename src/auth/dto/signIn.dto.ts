import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SignInDto {
  @IsString()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  securityCode?: string;
}
