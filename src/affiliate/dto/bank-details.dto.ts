import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class SaveBankDetailsDto {
  @IsNotEmpty()
  @IsString()
  holderName: string;

  @IsNotEmpty()
  @IsString()
  bankBranch: string;

  @IsNotEmpty()
  @IsString()
  accountNumber: string;

  @IsNotEmpty()
  @IsString()
  ifscCode: string;

  @IsNotEmpty()
  @IsString()
  upiId: string;

  @IsOptional()
  @IsString()
  panCardFile?: string;
}
