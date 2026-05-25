import { MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AffiliateController } from './affiliate.controller';
import { SuperAdminAffiliateController } from './superadmin-affiliate.controller';
import { AffiliateService } from './affiliate.service';
import { Affiliate, AffiliateSchema } from './schemas/affiliate.schema';
import { Referral, ReferralSchema } from './schemas/referral.schema';
import { Payout, PayoutSchema } from './schemas/payout.schema';
import { User, UserSchema } from 'src/schemas/User.schema';
import { GetAdminIdMiddleware } from 'src/middlewares/get-admin-id.middleware';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Affiliate.name, schema: AffiliateSchema },
      { name: Referral.name, schema: ReferralSchema },
      { name: Payout.name, schema: PayoutSchema },
      { name: User.name, schema: UserSchema },
    ]),
    JwtModule.register({}),
  ],
  controllers: [AffiliateController, SuperAdminAffiliateController],
  providers: [AffiliateService],
})
export class AffiliateModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(GetAdminIdMiddleware).forRoutes({
      path: 'affiliate*',
      method: RequestMethod.ALL,
    });
  }
}
