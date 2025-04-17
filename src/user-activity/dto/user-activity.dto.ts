import { IsMongoId, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateUserActivityDto {
  @IsNotEmpty()
  @IsString()
  action: string;

  @IsOptional()
  @IsString()
  details?: string;

  @IsOptional()
  @IsString()
  item?: string;
}

export class InactiviUserDTO {
  @IsNotEmpty()
  @IsString()
  userName: string;

  @IsNotEmpty()
  @IsString()
  email: string;

  @IsMongoId()
  userId: string;

  @IsNumber()
  @Min(1)
  seconds: number;
}
