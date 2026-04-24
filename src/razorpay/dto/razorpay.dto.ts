import {
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
import { DurationType } from 'src/schemas/BillingHistory.schema';

export class RazorPayUpdatePlanDTO {
  @IsMongoId()
  planId: string;

  @IsMongoId()
  adminId: string;

  @IsEnum(DurationType, {
    message: 'Duration type must be one of the allowed values.',
  })
  durationType: DurationType;
}

export class RazorPayCheckoutPlanDTO {
  @IsMongoId()
  plan: string;

  @IsEnum(DurationType, {
    message: 'Duration type must be one of the allowed values.',
  })
  durationType: DurationType;
}

export class RazorPayAddOnDTO {
  @IsMongoId()
  adminId: string;

  @IsMongoId()
  purchaseId: string;
}

export class RazorPayConfirmAddonDTO {
  @IsNotEmpty()
  @IsMongoId()
  purchaseId: string;

  @ValidateIf((o) => !o.razorpay_subscription_id)
  @IsString()
  @IsNotEmpty()
  razorpay_order_id?: string;

  @ValidateIf((o) => !o.razorpay_order_id)
  @IsString()
  @IsNotEmpty()
  razorpay_subscription_id?: string;

  @IsNotEmpty()
  @IsString()
  razorpay_payment_id: string;

  @IsNotEmpty()
  @IsString()
  razorpay_signature: string;
}
