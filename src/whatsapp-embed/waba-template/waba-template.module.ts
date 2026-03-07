import { forwardRef, MiddlewareConsumer, Module } from '@nestjs/common';
import { WabaTemplateController } from './waba-template.controller';
import { WabaTemplateService } from './waba-template.service';
import { WabaTemplateSchema, WabaTemplate } from './waba-template.schema';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from 'src/users/users.module';
import { ProjectsModule } from 'src/projects/projects.module';
import { WhatsappModule } from 'src/whatsapp/whatsapp.module';
import { AuthAdminTokenMiddleware } from 'src/middlewares/authAdmin.Middleware';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WabaTemplate.name, schema: WabaTemplateSchema },
    ]),
    forwardRef(() => UsersModule),
    forwardRef(() => ProjectsModule),

    forwardRef(() => WhatsappModule)
  ],
  controllers: [WabaTemplateController],
  providers: [WabaTemplateService],
  exports: [WabaTemplateService],
})
export class WabaTemplateModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthAdminTokenMiddleware)
      .forRoutes(WabaTemplateController);
  }
}
