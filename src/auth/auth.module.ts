import { MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersModule } from 'src/users/users.module';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from 'src/schemas/User.schema';
import { AuthSuperAdminMiddleware } from 'src/middlewares/authSuperAdmin.Middleware';
import { AuthAdminTokenMiddleware } from 'src/middlewares/authAdmin.Middleware';
import { AuthTokenMiddleware } from 'src/middlewares/authToken.Middleware';
import { SubscriptionModule } from 'src/subscription/subscription.module';

import {
  ExpiredPablyToken,
  ExpiredPablyTokenSchema,
} from 'src/schemas/ExpiredPablyToken.schema';
import { TwoFactorAuthenticationModule } from 'src/two-factor-authentication/two-factor-authentication.module';

@Module({
  imports: [
    UsersModule,
    JwtModule.register({
      global: true,
    }),
    MongooseModule.forFeature([
      {
        name: User.name,
        schema: UserSchema,
      },
      {
        name: ExpiredPablyToken.name,
        schema: ExpiredPablyTokenSchema,
      },
    ]),
    SubscriptionModule,
    TwoFactorAuthenticationModule
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthSuperAdminMiddleware)
      .forRoutes({ path: 'auth/client', method: RequestMethod.ALL });
    consumer
      .apply(AuthAdminTokenMiddleware)
      .forRoutes({ path: 'auth/employee', method: RequestMethod.ALL });

    consumer
      .apply(AuthTokenMiddleware)
      .forRoutes(
        { path: 'auth/current-user', method: RequestMethod.GET },
        { path: 'auth/pably-token', method: RequestMethod.POST },
      );
  }
}
