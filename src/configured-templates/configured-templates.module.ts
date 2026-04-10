import { forwardRef, MiddlewareConsumer, Module } from '@nestjs/common';
import { ConfiguredTemplatesService } from './configured-templates.service';
import { ConfiguredTemplatesController } from './configured-templates.controller';
import { AuthAdminTokenMiddleware } from 'src/middlewares/authAdmin.Middleware';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ConfiguredTemplate,
  ConfiguredTemplateSchema,
} from 'src/configured-templates/schema/configured-template.schema';
import { UsersModule } from 'src/users/users.module';
import { WhatsappModule } from 'src/whatsapp/whatsapp.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ConfiguredTemplate.name, schema: ConfiguredTemplateSchema },
    ]),
    forwardRef(() => UsersModule),
    WhatsappModule,
  ],
  providers: [ConfiguredTemplatesService],
  exports: [ConfiguredTemplatesService],
  controllers: [ConfiguredTemplatesController],
})
export class ConfiguredTemplatesModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthAdminTokenMiddleware)
      .forRoutes(ConfiguredTemplatesController);
  }
}
