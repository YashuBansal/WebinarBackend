import {
  forwardRef,
  MiddlewareConsumer,
  Module,
  RequestMethod,
} from '@nestjs/common';
import { RazorpayService } from './razorpay.service';
import { RazorpayController } from './razorpay.controller';
import { SubscriptionModule } from 'src/subscription/subscription.module';
import { AddonModule } from 'src/addon/addon.module';
import { AuthAdminTokenMiddleware } from 'src/middlewares/authAdmin.Middleware';
import { AddonPurchaseModule } from 'src/addon-purchase/addon-purchase.module';

@Module({
  imports: [
    forwardRef(() => AddonModule),
    forwardRef(() => SubscriptionModule),
    forwardRef(() => AddonPurchaseModule),
  ],
  providers: [RazorpayService],
  controllers: [RazorpayController],
  exports: [RazorpayService],
})
export class RazorpayModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthAdminTokenMiddleware)
      .forRoutes(
        { path: 'razorpay/checkout', method: RequestMethod.POST },
        { path: 'razorpay/addon/checkout', method: RequestMethod.POST },
      );
  }
}
