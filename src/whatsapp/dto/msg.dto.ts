import { Type } from 'class-transformer';
import {
  IsArray,
  IsPhoneNumber,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsMongoId,
  ValidateNested,
} from 'class-validator'; 
import { VariableMappingDto } from 'src/webinar-auto-message/dto';
import { WabaMessageType } from 'src/whatsapp-embed/waba-message/waba-message.schema';

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

  @IsOptional()
  @IsMongoId()
  contactId?: string; // ID of the contact (optional for individual messages)
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
  @ValidateNested({ each: true })
  @Type(() => VariableMappingDto)
  @IsOptional()
  variableMappings?: VariableMappingDto[]; // Variable mappings for template variables

  @IsOptional()
  @IsMongoId()
  headerMediaAssetId?: string; // ID of the media asset to use for header
}


export interface IFormattedPhoneData {
  phoneNumber: string;
  digitsOnly: string;
  isValid: boolean;
}

export interface ISendSingleTemplateMessagePayload {
  adminId: string;
  projectId: string;
  formattedPhoneData: IFormattedPhoneData;
  templateName: string;
  fromPhoneNumberId: string;
  permanentAccessToken: string;
  messageType: WabaMessageType;
  templateStructure: {
    name: string;
    language: string;
    components: {
      type: string;
      parameters: {
        type: string;
        value: string;
      }[];
    }[];
  };
  language: string;
  contactId?: string;
  campaignId?: string;
  attendeeId?: string;
  meetingId?: string;
  occurrenceId?: string;
  apiCampaignId?: string;
  // Program-based messaging (optional)
  programId?: string;
  programAssignmentId?: string;
  occurrenceIndex?: number;
  timeSlotIndex?: number;
  executionLogId?: string;
  programMessageType?: 'template' | 'session';
}