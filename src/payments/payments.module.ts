import { forwardRef, Module } from '@nestjs/common';
import { AddonPurchaseModule } from 'src/addon-purchase/addon-purchase.module';
import { RazorpayWebhookController } from './razorpay-webhook.controller';

@Module({
  imports: [forwardRef(() => AddonPurchaseModule)],
  controllers: [RazorpayWebhookController],
})
export class PaymentsModule {}
