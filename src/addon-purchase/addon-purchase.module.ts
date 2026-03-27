import { forwardRef, MiddlewareConsumer, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AddonPurchase,
  AddonPurchaseSchema,
} from 'src/schemas/AddonPurchase.schema';
import { AddonPurchaseService } from './addon-purchase.service';
import { AddonPurchaseController } from './addon-purchase.controller';
import { AddonModule } from 'src/addon/addon.module';
import { SubscriptionModule } from 'src/subscription/subscription.module';
import { RazorpayModule } from 'src/razorpay/razorpay.module';
import { SubscriptionAddonModule } from 'src/subscription-addon/subscription-addon.module';
import { AuthAdminTokenMiddleware } from 'src/middlewares/authAdmin.Middleware';
import { BillingHistoryModule } from 'src/billing-history/billing-history.module';
import { UsersModule } from 'src/users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AddonPurchase.name, schema: AddonPurchaseSchema },
    ]),
    AddonModule,
    SubscriptionModule,
    UsersModule,
    forwardRef(() => RazorpayModule),
    forwardRef(() => SubscriptionAddonModule),
    BillingHistoryModule,
    
  ],
  providers: [AddonPurchaseService],
  controllers: [AddonPurchaseController],
  exports: [AddonPurchaseService],
})
export class AddonPurchaseModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthAdminTokenMiddleware).forRoutes(AddonPurchaseController);
  }
}

