import {
  IsMongoId,
  IsNotEmpty,
  IsString,
  ValidateIf,
} from 'class-validator';

export class RazorpayConfirmAddonDto {
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
