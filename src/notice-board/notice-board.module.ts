import { MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { NoticeBoardController } from './notice-board.controller';
import { NoticeBoardService } from './notice-board.service';
import { MongooseModule } from '@nestjs/mongoose';
import { NoticeBoard, NoticeBoardSchema } from 'src/schemas/notice-board.schema';
import { UsersModule } from 'src/users/users.module';
import { AuthAdminTokenMiddleware } from 'src/middlewares/authAdmin.Middleware';
import { AuthTokenMiddleware } from 'src/middlewares/authToken.Middleware';
import { GetAdminIdMiddleware } from 'src/middlewares/get-admin-id.middleware';
import { NotificationModule } from 'src/notification/notification.module';

@Module({
  imports: [
    UsersModule,
    NotificationModule,
    MongooseModule.forFeature([
    {
      name: NoticeBoard.name,
      schema: NoticeBoardSchema,
    },
    
  ]),],
  controllers: [NoticeBoardController],
  providers: [NoticeBoardService]
})
export class NoticeBoardModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthAdminTokenMiddleware).forRoutes({
      path: 'notice-board',
      method: RequestMethod.POST,
    });

    consumer.apply(GetAdminIdMiddleware).forRoutes({
      path: 'notice-board',
      method: RequestMethod.GET,
    });
  }
}
