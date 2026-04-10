import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CancelProgramAssignmentByNameDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  programName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phone: string;
}
