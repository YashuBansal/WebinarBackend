import { IsNotEmpty, IsString } from 'class-validator';

export class FetchWabaDetailsDto {
  @IsString()
  @IsNotEmpty()
  readonly wabaId: string;

  @IsString()
  @IsNotEmpty()
  readonly accessToken: string;
}
