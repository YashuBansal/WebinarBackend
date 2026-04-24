import {
  IsBoolean,
  IsNumber,
  Min,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateIf,
} from 'class-validator';

export class CreateAddOnDto {
  @IsString()
  @IsNotEmpty()
  addonName: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  employeeLimit: number;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  contactLimit: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  webinarLimit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  whatsappProjectLimit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  zoomProjectLimit?: number;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  addOnPrice: number;

  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  validityInDays: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Required for active add-ons: Razorpay Subscriptions plan id (test/live must match the server). */
  @ValidateIf((o) => o.isActive !== false)
  @IsString()
  @IsNotEmpty()
  @Matches(/^plan_[A-Za-z0-9]+$/i, {
    message: 'razorpayPlanId must be a Razorpay plan id (e.g. plan_xxx)',
  })
  razorpayPlanId?: string;
}

export class UpdateAddOnDto {
  @IsNumber()
  @Min(0)
  employeeLimit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  contactLimit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  webinarLimit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  whatsappProjectLimit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  zoomProjectLimit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  addOnPrice?: number;

  @IsOptional()
  @IsNotEmpty()
  @Min(1)
  validityInDays?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ValidateIf((o) => o.isActive === true)
  @IsString()
  @IsNotEmpty()
  @Matches(/^plan_[A-Za-z0-9]+$/i, {
    message: 'razorpayPlanId must be a Razorpay plan id (e.g. plan_xxx)',
  })
  razorpayPlanId?: string;
}
