import { Module } from '@nestjs/common';
import { AddonPurchaseModule } from 'src/addon-purchase/addon-purchase.module';
import { RazorpayWebhookController } from './razorpay-webhook.controller';

@Module({
  imports: [AddonPurchaseModule],
  controllers: [RazorpayWebhookController],
})
export class PaymentsModule {}
