import { IsArray, IsPhoneNumber, IsString, IsNotEmpty, IsOptional, IsMongoId } from 'class-validator';

export class AlarmMsgDto {
  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsNotEmpty()
  note: string;

  @IsString()
  @IsNotEmpty()
  userName: string;

  @IsString()
  @IsNotEmpty()
  attendeeEmail: string;
}


export class ReminderMsgDto {
    @IsString()
    @IsNotEmpty()
    phone: string;
  
    @IsString()
    @IsNotEmpty()
    note: string;
  
    @IsString()
    @IsNotEmpty()
    userName: string;
  
    @IsString()
    @IsNotEmpty()
    attendeeEmail: string;
  }
  

  export class SendTemplateMessageDto {
    @IsNotEmpty()
    @IsString()
    projectId: string;
  
    @IsNotEmpty()
    @IsPhoneNumber() // Validates that it's a valid phone number format (e.g., +15551234567)
    recipientPhoneNumber: string;
  
    @IsNotEmpty()
    @IsString()
    templateName: string;
  
    @IsString()
    @IsOptional()
    language?: string; // Defaults to template's language if not provided
  
    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    bodyVariables?: string[]; // e.g., ["John Doe", "AB-123"]

    @IsOptional()
    @IsMongoId()
    headerMediaAssetId?: string; // ID of the media asset to use for header
  }

  export class ContactDto {
    @IsNotEmpty()
    @IsString()
    contactId: string;

    @IsNotEmpty()
    @IsPhoneNumber()
    phoneNumber: string;
  }

  export class SendBulkTemplateMessageDto {
    @IsNotEmpty()
    @IsString()
    projectId: string;
  
    @IsArray()
    @IsNotEmpty()
    contacts: ContactDto[];
  
    @IsNotEmpty()
    @IsString()
    templateName: string;
  
    @IsString()
    @IsOptional()
    language?: string; // Defaults to template's language if not provided
  
    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    bodyVariables?: string[]; // e.g., ["John Doe", "AB-123"]

    @IsOptional()
    @IsMongoId()
    headerMediaAssetId?: string; // ID of the media asset to use for header
  }
  