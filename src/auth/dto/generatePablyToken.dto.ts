import { IsOptional, IsDateString } from 'class-validator';

export class GeneratePablyTokenDto {
  @IsOptional()
  @IsDateString()
  expiry?: string;
}
