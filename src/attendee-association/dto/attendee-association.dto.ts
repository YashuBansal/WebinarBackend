import {
  IsEmail,
  IsMongoId,
  IsNotEmpty,
  IsString,
  IsEnum,
} from 'class-validator';
import { Types } from 'mongoose';

export class AttendeeAssociationDto {
  @IsNotEmpty({ message: 'Lead type is required' })
  @IsMongoId({ message: 'Lead type must be a valid MongoId' })
  leadType: Types.ObjectId;

  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Email must be a valid email address' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'createdBy is required' })
  createdBy: string;

  @IsString()
  @IsNotEmpty({ message: 'leadType Label is required' })
  leadTypeLabel: string;
}

export class UpdateAttendeeTagDto {
  @IsString()
  @IsNotEmpty({ message: 'Tag is required' })
  tag: string;

  @IsEnum(['add', 'remove'], {
    message: 'Action must be either "add" or "remove"',
  })
  @IsNotEmpty({ message: 'Action is required' })
  action: 'add' | 'remove';
}
