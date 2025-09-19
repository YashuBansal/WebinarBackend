import { forwardRef, MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { HttpModule } from '@nestjs/axios';
import { UsersModule } from 'src/users/users.module';
import { WhatsappController } from './whatsapp.controller';
import { ProjectsModule } from 'src/projects/projects.module';
import { AuthAdminTokenMiddleware } from 'src/middlewares/authAdmin.Middleware';

@Module({
  imports: [HttpModule, forwardRef(() => UsersModule), ProjectsModule],
  providers: [WhatsappService],
  exports: [WhatsappService],
  controllers: [WhatsappController],
})
export class WhatsappModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthAdminTokenMiddleware)
    .exclude({ path: 'whatsapp/webhook', method: RequestMethod.ALL })
    .forRoutes(WhatsappController);
  }
}
