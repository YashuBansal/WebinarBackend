import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  ValidateNested,
  IsDateString,
  IsEnum,
  IsBoolean,
  IsObject,
  IsNumber,
  IsMongoId,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  AdvanceFilterFieldType,
  AdvanceFilterLogicOperator,
  AdvanceFilterMode,
  AdvanceFilterOperator,
} from 'src/schemas/advance-filter.schema';
import { VariableMappingDto } from 'src/webinar-auto-message/dto';

export class MessageTemplateDto {
  @IsString()
  @IsNotEmpty()
  templateName: string;

  @IsString()
  @IsNotEmpty()
  body: string;
}

export class ContactSelectionDto {
  @IsString()
  @IsNotEmpty()
  contactId: string;

  @IsString()
  @IsNotEmpty()
  phoneNumber: string;
}

export class WlhFilterConditionDto {
  @IsEnum(AdvanceFilterMode)
  mode: AdvanceFilterMode;

  // Keep field flexible – backend maps it using advance-filter schema config
  @IsString()
  field: string;

  @IsEnum(AdvanceFilterOperator)
  operator: AdvanceFilterOperator;

  @IsArray()
  @IsString({ each: true })
  value: string[];

  @IsEnum(AdvanceFilterLogicOperator)
  logicOperator: AdvanceFilterLogicOperator;

  @IsEnum(AdvanceFilterFieldType)
  fieldType: AdvanceFilterFieldType;

  @IsBoolean()
  isMultiple: boolean;
}

export class WlhFiltersDto {
  @IsArray()
  @IsMongoId({ each: true })
  webinarIds: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WlhFilterConditionDto)
  conditions: WlhFilterConditionDto[];
}

export class WlhAttendeeFiltersDto {
  @IsObject()
  @ValidateNested()
  @Type(() => WlhFiltersDto)
  filters: WlhFiltersDto;

  @IsNumber()
  contactCount: number;

  // Attendance segment (sales / reminder)
  @IsOptional()
  @IsBoolean()
  isAttended?: boolean;
}

export class CreateCampaignWorkflowDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  projectId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContactSelectionDto)
  selectedContacts: ContactSelectionDto[];

  @IsString()
  @IsOptional()
  templateName?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariableMappingDto)
  @IsOptional()
  variableMappings?: VariableMappingDto[];

  @IsString()
  @IsOptional()
  sessionTemplateName?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariableMappingDto)
  @IsOptional()
  sessionVariableMappings?: VariableMappingDto[];

  @IsEnum(['now', 'scheduled'])
  @IsNotEmpty()
  sendType: 'now' | 'scheduled';

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  headerMediaAssetId?: string;

  @IsEnum(['whatsapp', 'wlh'])
  @IsNotEmpty()
  contactType: 'whatsapp' | 'wlh';

  @IsOptional()
  @ValidateNested()
  @Type(() => WlhAttendeeFiltersDto)
  wlhAttendeeFilters?: WlhAttendeeFiltersDto;
}

export class CampaignPreviewDto {
  @IsString()
  @IsNotEmpty()
  campaignId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContactSelectionDto)
  sampleContacts: ContactSelectionDto[];
}
