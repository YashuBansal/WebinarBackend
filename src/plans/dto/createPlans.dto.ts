import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PlanType } from '../Plans.schema';

export class PlanDurationConfigDto {
  @IsNumber()
  duration: number;

  @IsString()
  discountType: string;

  @IsNumber()
  discountValue: number;

  @IsNumber()
  price: number;

  @IsBoolean()
  isEnabled: boolean;

  @ValidateIf((o) => o.isEnabled === true)
  @IsString()
  @IsNotEmpty()
  @Matches(/^plan_[A-Za-z0-9]+$/i, {
    message: 'razorpayPlanId must be a Razorpay Subscriptions plan id (e.g. plan_xxx)',
  })
  razorpayPlanId?: string;
}

export class CreatePlansDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  internalName: string;

  @IsNumber()
  @IsNotEmpty()
  employeeCount: number;

  @IsNumber()
  @IsNotEmpty()
  contactLimit: number;

  @IsObject()
  @IsNotEmpty()
  attendeeTableConfig: Map<string, any>;

  @IsNumber()
  @Min(0, { message: 'Minimum value is 0' })
  toggleLimit: number;

  @IsNumber()
  @Min(0, { message: 'Minimum value is 0' })
  whatsappProjectLimit: number;

  @IsNumber()
  @Min(0, { message: 'Minimum value is 0' })
  zoomProjectLimit: number;

  @IsNumber()
  @Min(0, { message: 'Minimum value is 0' })
  webinarLimit: number;

  @IsEnum(PlanType)
  planType: PlanType;

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  assignedUsers: string[];

  @IsOptional()
  @IsBoolean()
  whatsappNotificationOnAlarms: boolean;

  @IsOptional()
  @IsBoolean()
  employeeInactivity: boolean;

  @IsOptional()
  @IsBoolean()
  employeeRealTimeStatusUpdate: boolean;

  @IsOptional()
  @IsBoolean()
  calendarFeatures: boolean;

  @IsOptional()
  @IsBoolean()
  productRevenueMetrics: boolean;

  @IsOptional()
  @IsBoolean()
  setAlarm: boolean;

  @IsOptional()
  @IsBoolean()
  renewalNotAllowed: boolean;

  @IsOptional()
  @IsString()
  customRibbon: string;

  @IsOptional()
  @IsString()
  customRibbonColor: string;

  @IsOptional()
  @IsBoolean()
  assignmentMetrics: boolean;

  @IsOptional()
  @IsBoolean()
  isDefaultSignupPlan: boolean;

  @IsObject()
  @IsNotEmpty()
  planDurationConfig: Map<string, PlanDurationConfigDto>;
}

class PlanDTO {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @Min(0, { message: 'Minimum value is 0' })
  sortOrder: number;

  @IsMongoId()
  id: string;
}

export class PlanOrderDTO {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanDTO)
  plans: PlanDTO[];
}

export class IdParamsDTO {
  @IsMongoId()
  id: string;
}
