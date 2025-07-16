import { forwardRef, MiddlewareConsumer, Module } from '@nestjs/common';
import { RevenueController } from './revenue.controller';
import { RevenueService } from './revenue.service';
import { MongooseModule } from '@nestjs/mongoose';
import {
  BillingHistory,
  BillingHistorySchema,
} from '../schemas/BillingHistory.schema';
import { AuthSuperAdminMiddleware } from 'src/middlewares/authSuperAdmin.Middleware';
import { UsersModule } from 'src/users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BillingHistory.name, schema: BillingHistorySchema },
    ]),
    forwardRef(() =>UsersModule),
  ],
  controllers: [RevenueController],
  providers: [RevenueService],
  exports: [RevenueService],
})
export class RevenueModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthSuperAdminMiddleware).forRoutes(RevenueController);
  }
}
