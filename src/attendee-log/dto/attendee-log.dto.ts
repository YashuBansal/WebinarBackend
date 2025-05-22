import {
  IsEnum,
  IsOptional,
  IsDateString,
  IsNumberString,
} from 'class-validator';
import { AttendeeAction } from 'src/schemas/attendee-logs.schema';

export class FetchAttendeeLogDTO {
  @IsOptional()
  @IsEnum(AttendeeAction)
  action?: AttendeeAction;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsNumberString()
  page: string;

  @IsNumberString()
  limit: string;
}
