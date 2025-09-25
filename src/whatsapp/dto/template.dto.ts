import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsArray,
  ValidateNested,
  IsObject,
  MaxLength,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';

// Template Categories as per WhatsApp API
export enum TemplateCategory {
  UTILITY = 'UTILITY',
  MARKETING = 'MARKETING',
  AUTHENTICATION = 'AUTHENTICATION',
}

// Template Component Types
export enum ComponentType {
  HEADER = 'HEADER',
  BODY = 'BODY',
  FOOTER = 'FOOTER',
  BUTTONS = 'BUTTONS',
}

// Header Format Types
export enum HeaderFormat {
  TEXT = 'TEXT',
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO',
  DOCUMENT = 'DOCUMENT',
  LOCATION = 'LOCATION',
}

// Button Types
export enum ButtonType {
  QUICK_REPLY = 'QUICK_REPLY',
  URL = 'URL',
  PHONE_NUMBER = 'PHONE_NUMBER',
  OTP = 'OTP',
  MPM = 'MPM',
  CATALOG = 'CATALOG',
  FLOW = 'FLOW',
  VOICE_CALL = 'VOICE_CALL',
  APP = 'APP',
}

// Parameter Format Types
export enum ParameterFormat {
  POSITIONAL = 'POSITIONAL',
  NAMED = 'NAMED',
}

// Button DTO
export class ButtonDto {
  @IsEnum(ButtonType)
  @IsNotEmpty()
  type: ButtonType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(25, { message: 'Button text must not exceed 25 characters' })
  text: string;

  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsString()
  phone_number?: string;

  @IsOptional()
  @IsString()
  otp_type?: string;
}

// Example DTO for template examples
export class ExampleDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  header_text?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  header_handle?: string[];

  @IsOptional()
  @IsArray()
  @IsArray({ each: true })
  // @IsString({ each: true })
  body_text?: string[][];
}

// Component DTO
export class ComponentDto {
  @IsEnum(ComponentType)
  @IsNotEmpty()
  type: ComponentType;

  @IsOptional()
  @IsEnum(HeaderFormat)
  format?: HeaderFormat;

  @IsOptional()
  @IsString()
  @MaxLength(1024, {
    message: 'Component text must not exceed 1024 characters',
  })
  text?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ButtonDto)
  @ArrayMinSize(1, {
    message: 'At least one button is required for BUTTONS component',
  })
  @ArrayMaxSize(3, { message: 'Maximum 3 buttons allowed' })
  buttons?: ButtonDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ExampleDto)
  example?: ExampleDto;
}

// Create Template DTO
export class CreateTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512, { message: 'Template name must not exceed 512 characters' })
  name: string;

  @IsEnum(TemplateCategory)
  @IsNotEmpty()
  category: TemplateCategory;

  @IsOptional()
  @IsEnum(ParameterFormat)
  parameter_format?: ParameterFormat;

  @IsString()
  @IsNotEmpty()
  language: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ComponentDto)
  @ArrayMinSize(1, { message: 'At least one component is required' })
  components: ComponentDto[];

  @IsOptional()
  @IsString()
  library_template_name?: string;

  @IsOptional()
  @IsObject()
  library_template_button_inputs?: any;
}

// Update Template DTO
export class UpdateTemplateDto {
  @IsOptional()
  @IsEnum(TemplateCategory)
  category?: TemplateCategory;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ComponentDto)
  components?: ComponentDto[];
}

// Template Response DTO
export class TemplateResponseDto {
  @IsString()
  id: string;

  @IsString()
  status: string;

  @IsEnum(TemplateCategory)
  category: TemplateCategory;

  @IsString()
  name: string;

  @IsString()
  language: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ComponentDto)
  components: ComponentDto[];

  @IsOptional()
  @IsString()
  quality_score?: string;

  @IsOptional()
  @IsString()
  rejected_reason?: string;
}

// Get Templates Query DTO
export class GetTemplatesQueryDto {
  @IsOptional()
  @IsString()
  fields?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  name?: string;
}

// Delete Template DTO
export class DeleteTemplateDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  hsm_id: string;
}
