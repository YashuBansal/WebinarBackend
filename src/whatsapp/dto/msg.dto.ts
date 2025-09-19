import { IsArray, IsPhoneNumber, IsString, IsNotEmpty, IsOptional } from 'class-validator';

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
    language?: string; // e.g., "en_US", "en_GB", "es_ES"
  
    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    bodyVariables?: string[]; // e.g., ["John Doe", "AB-123"]
  }
  