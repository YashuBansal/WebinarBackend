import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsBoolean,
  MinLength,
} from 'class-validator';
import { ResponseType } from '../chatbot-trigger.schema';

export class CreateChatbotTriggerDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  keyword: string;

  @IsEnum(['link', 'text'])
  responseType: ResponseType;

  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  responseValue: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsString()
  @IsNotEmpty()
  projectId: string;
}
