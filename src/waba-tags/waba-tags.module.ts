import { MiddlewareConsumer, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WabaTagsController } from './waba-tags.controller';
import { WabaTagsService } from './waba-tags.service';
import { WabaTag, WabaTagSchema } from 'src/schemas/waba-tags.schema';
import { AuthAdminTokenMiddleware } from 'src/middlewares/authAdmin.Middleware';
import { UsersModule } from 'src/users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: WabaTag.name, schema: WabaTagSchema }]),
    UsersModule,
  ],
  controllers: [WabaTagsController],
  providers: [WabaTagsService],
  exports: [WabaTagsService],
})
export class WabaTagsModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthAdminTokenMiddleware).forRoutes(WabaTagsController);
  }
}
