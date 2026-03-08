import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsUrl, IsObject, ValidateNested, ValidateIf } from 'class-validator';

export class CreateWebinarWebhookDto {
  @IsString()
  @IsNotEmpty()
  webinarId: string;

  @IsString()
  @IsNotEmpty()
  webhookName: string;

  @IsOptional()
  @IsUrl()
  webhookUrl?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isResponseCaptured?: boolean;
}

export class UpdateWebinarWebhookDto {
  @IsOptional()
  @IsString()
  webhookName?: string;

  @IsOptional()
  @IsUrl()
  webhookUrl?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isResponseCaptured?: boolean;

  @IsOptional()
  @IsObject()
  fieldMapping?: {
    email?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    location?: string;
    gender?: string;
    profession?: string;
    tags?: string;
    source?: string;
  };

  @IsOptional()
  @IsObject()
  staticValues?: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    location?: string;
    gender?: string;
    profession?: string;
    tags?: string;
    source?: string;
  };
}

