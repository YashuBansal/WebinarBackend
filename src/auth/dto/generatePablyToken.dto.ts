import {
  IsOptional,
  IsDateString,
  IsString,
  IsNotEmpty,
} from 'class-validator';

export class GeneratePablyTokenDto {
  @IsOptional()
  @IsDateString()
  expiry?: string;

  @IsString()
  @IsNotEmpty()
  label: string;
}
