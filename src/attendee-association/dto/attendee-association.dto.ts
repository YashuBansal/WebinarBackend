import { IsEmail, IsMongoId, IsNotEmpty, IsString } from 'class-validator';
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
