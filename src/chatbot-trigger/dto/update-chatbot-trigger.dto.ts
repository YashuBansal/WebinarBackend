import { IsString, IsOptional, IsEnum, IsBoolean, MinLength } from 'class-validator';
import { ResponseType } from '../chatbot-trigger.schema';

export class UpdateChatbotTriggerDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  keyword?: string;

  @IsOptional()
  @IsEnum(['link', 'text'])
  responseType?: ResponseType;

  @IsOptional()
  @IsString()
  @MinLength(1)
  responseValue?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
