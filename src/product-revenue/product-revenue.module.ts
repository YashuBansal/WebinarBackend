import { forwardRef, MiddlewareConsumer, Module } from '@nestjs/common';
import { ProductRevenueController } from './product-revenue.controller';
import { ProductRevenueService } from './product-revenue.service';
import { ProductsModule } from 'src/products/products.module';
import { EnrollmentsModule } from 'src/enrollments/enrollments.module';
import { MongooseModule } from '@nestjs/mongoose';
import { Enrollment, EnrollmentSchema } from 'src/schemas/Enrollments.schema';
import { AuthAdminTokenMiddleware } from 'src/middlewares/authAdmin.Middleware';
import { UsersModule } from 'src/users/users.module';

@Module({
  imports: [
    EnrollmentsModule,
    MongooseModule.forFeature([
      {
        name: Enrollment.name,
        schema: EnrollmentSchema,
      },
    ]),
    forwardRef(() => UsersModule),
    ProductsModule,
  ],
  controllers: [ProductRevenueController],
  providers: [ProductRevenueService],
  exports: [ProductRevenueService],
})
export class ProductRevenueModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthAdminTokenMiddleware)
      .forRoutes(ProductRevenueController);
  }
}
