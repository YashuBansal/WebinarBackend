import { IsNotEmpty, IsOptional, IsString, MaxLength, IsObject } from 'class-validator';

export class CreateProgramAssignmentByNameDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  programName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phone: string;

  @IsOptional()
  @IsObject()
  variables?: Record<string, string>;
}

