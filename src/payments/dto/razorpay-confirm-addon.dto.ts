import { IsMongoId, IsNotEmpty, IsString } from 'class-validator';

export class RazorpayConfirmAddonDto {
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
