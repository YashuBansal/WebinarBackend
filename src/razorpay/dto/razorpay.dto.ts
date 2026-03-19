import { IsEnum, IsMongoId, IsNotEmpty, IsString } from 'class-validator';
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
  addonId: string;

  @IsMongoId()
  adminId: string;
}

export class RazorPayConfirmAddonDTO {
  @IsNotEmpty()
  @IsMongoId()
  purchaseId: string;

  @IsNotEmpty()
  @IsString()
  razorpay_order_id: string;

  @IsNotEmpty()
  @IsString()
  razorpay_payment_id: string;

  @IsNotEmpty()
  @IsString()
  razorpay_signature: string;
}
