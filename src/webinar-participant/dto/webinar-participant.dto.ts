import {
  IsArray,
  IsDateString,
  IsEmail,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Types } from 'mongoose';

/**
 * DTO for creating or representing a WebinarParticipant with all fields.
 * Validates the incoming data against the schema's rules.
 */

export class WebinarParticipantDto {
  @IsEmail({}, { message: 'A valid email address is required.' })
  @MaxLength(100)
  @IsNotEmpty({ message: 'Email cannot be empty.' })
  email: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  firstName?: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  lastName?: string;

  @IsDateString({}, { message: 'inTime must be a valid ISO 8601 date string.' })
  @IsOptional()
  inTime?: Date;

  @IsDateString(
    {},
    { message: 'outTime must be a valid ISO 8601 date string.' },
  )
  @IsOptional()
  outTime?: Date;
}

export class CreateWebinarParticipantDto extends WebinarParticipantDto {
  // --- Mandatory Fields ---

  @IsMongoId({ message: 'A valid webinar ID string is required.' })
  @IsNotEmpty({ message: 'Webinar ID is required.' })
  webinar: Types.ObjectId; // Can also be string; class-transformer can handle conversion

  @IsMongoId({ message: 'A valid admin ID string is required.' })
  @IsNotEmpty({ message: 'Admin ID is required.' })
  adminId: Types.ObjectId; // Can also be string
}
