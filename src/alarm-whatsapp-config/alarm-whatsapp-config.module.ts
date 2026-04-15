import { MiddlewareConsumer, Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AlarmWhatsappConfig,
  AlarmWhatsappConfigSchema,
} from './alarm-whatsapp-config.schema';
import { AlarmWhatsappConfigService } from './alarm-whatsapp-config.service';
import { AlarmWhatsappConfigController } from './alarm-whatsapp-config.controller';
import { AuthAdminTokenMiddleware } from 'src/middlewares/authAdmin.Middleware';
import { UsersModule } from 'src/users/users.module';
import { WhatsappModule } from 'src/whatsapp/whatsapp.module';
import { ProjectsModule } from 'src/projects/projects.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AlarmWhatsappConfig.name, schema: AlarmWhatsappConfigSchema },
    ]),
    forwardRef(() => UsersModule),
    forwardRef(() => WhatsappModule),
    forwardRef(() => ProjectsModule),
  ],
  controllers: [AlarmWhatsappConfigController],
  providers: [AlarmWhatsappConfigService],
  exports: [AlarmWhatsappConfigService],
})
export class AlarmWhatsappConfigModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthAdminTokenMiddleware)
      .forRoutes(AlarmWhatsappConfigController);
  }
}
