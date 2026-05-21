import { IsOptional, IsString, IsNotEmpty } from 'class-validator';

export class UpdateZoomProjectDto {
  @IsNotEmpty()
  @IsString()
  projectName: string;
}
