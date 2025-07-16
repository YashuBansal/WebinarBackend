import { MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { SidebarLinksController } from './sidebar-links.controller';
import { SidebarLinksService } from './sidebar-links.service';
import { MongooseModule } from '@nestjs/mongoose';
import { SidebarLinks, SidebarLinksSchema } from 'src/schemas/SidebarLinks.schema';
import { AuthSuperAdminMiddleware } from 'src/middlewares/authSuperAdmin.Middleware';
import { UsersModule } from 'src/users/users.module';
import { AuthTokenMiddleware } from 'src/middlewares/authToken.Middleware';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: SidebarLinks.name,
        schema: SidebarLinksSchema,
      },
    ]),
    UsersModule
  ],
  controllers: [SidebarLinksController],
  providers: [SidebarLinksService]
})
export class SidebarLinksModule {
  configure(consumer: MiddlewareConsumer) {
      consumer
        .apply(AuthSuperAdminMiddleware)
        .exclude({ path: 'sidebar-links', method: RequestMethod.GET })
        .forRoutes(SidebarLinksController);

        consumer
        .apply(AuthTokenMiddleware)
        .forRoutes({ path: 'sidebar-links', method: RequestMethod.GET });

  }
}
