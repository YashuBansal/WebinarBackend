import {
  forwardRef,
  MiddlewareConsumer,
  Module,
  RequestMethod,
} from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from 'src/schemas/User.schema';
import { SubscriptionModule } from 'src/subscription/subscription.module';
import { BillingHistoryModule } from 'src/billing-history/billing-history.module';
import { AuthSuperAdminMiddleware } from 'src/middlewares/authSuperAdmin.Middleware';
import { AuthAdminTokenMiddleware } from 'src/middlewares/authAdmin.Middleware';
import { AuthTokenMiddleware } from 'src/middlewares/authToken.Middleware';
import { RolesModule } from 'src/roles/roles.module';
import { PlansModule } from 'src/plans/plans.module';
import { diskStorage } from 'multer';
import { MulterModule } from '@nestjs/platform-express';

import { CustomLeadTypeModule } from 'src/custom-lead-type/custom-lead-type.module';
import { NotificationModule } from 'src/notification/notification.module';
import { ProductsModule } from 'src/products/products.module';
import { WebsocketModule } from 'src/websocket/websocket.module';
import { TwoFactorAuthenticationModule } from 'src/two-factor-authentication/two-factor-authentication.module';
import { ApiAccessTokenModule } from 'src/api-access-token/api-access-token.module';
import { RedisModule } from 'src/redis/redis.module';
import { UserCacheService } from './user-cache.service';

@Module({
  imports: [
    RedisModule,
    MulterModule.register({
      storage: diskStorage({
        destination: './documents',
        filename: (req, file, cb) => {
          const filename = `${Date.now()}-${file.originalname}`;
          cb(null, filename);
        },
      }),
    }),
    forwardRef(() => SubscriptionModule),
    MongooseModule.forFeature([
      {
        name: User.name,
        schema: UserSchema,
      },
    ]),
    BillingHistoryModule,
    NotificationModule,
    RolesModule,
    forwardRef(() => PlansModule),
    forwardRef(() => CustomLeadTypeModule),
    forwardRef(() => ProductsModule),
    WebsocketModule,
    ApiAccessTokenModule,
    TwoFactorAuthenticationModule,
  ],
  controllers: [UsersController],
  providers: [UsersService, UserCacheService],
  exports: [UsersService],
})
export class UsersModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthTokenMiddleware)
      .forRoutes(
        { path: 'users', method: RequestMethod.PATCH },
        { path: 'users/password', method: RequestMethod.PATCH },
      );

    consumer
      .apply(AuthAdminTokenMiddleware)
      .forRoutes(
        { path: 'users/employee*', method: RequestMethod.ALL },
        { path: 'users/document*', method: RequestMethod.DELETE },
        { path: 'users/super-admin', method: RequestMethod.GET },
        { path: 'users/verify-admin-token', method: RequestMethod.GET },
      );

    consumer.apply(AuthSuperAdminMiddleware).forRoutes(
      { path: 'users/clients/*', method: RequestMethod.ALL },
      { path: 'users/secret', method: RequestMethod.ALL },
      {
        path: 'users/super-admin/whatsapp-token',
        method: RequestMethod.PATCH,
      },
    );
  }
}
