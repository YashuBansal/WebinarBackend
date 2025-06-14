import { MiddlewareConsumer, Module } from '@nestjs/common';
import { BillingHistoryService } from './billing-history.service';
import { BillingHistoryController } from './billing-history.controller';
import { MongooseModule } from '@nestjs/mongoose';
import {
  BillingHistory,
  BillingHistorySchema,
} from 'src/schemas/BillingHistory.schema';
import { AuthAdminTokenMiddleware } from 'src/middlewares/authAdmin.Middleware';
import { Counter, CounterSchema } from 'src/schemas/counter.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Counter.name, schema: CounterSchema },
      {
        name: BillingHistory.name,
        schema: BillingHistorySchema,
      },
    ]),
  ],
  providers: [BillingHistoryService],
  controllers: [BillingHistoryController],
  exports: [BillingHistoryService],
})
export class BillingHistoryModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthAdminTokenMiddleware)
      .forRoutes(BillingHistoryController);
  }
}
