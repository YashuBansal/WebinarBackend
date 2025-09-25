import {
  forwardRef,
  MiddlewareConsumer,
  Module,
  RequestMethod,
} from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { HttpModule } from '@nestjs/axios';
import { UsersModule } from 'src/users/users.module';
import { WhatsappController } from './whatsapp.controller';
import { ProjectsModule } from 'src/projects/projects.module';
import { AuthAdminTokenMiddleware } from 'src/middlewares/authAdmin.Middleware';
import { MongooseModule } from '@nestjs/mongoose';
import { MediaAsset, MediaAssetSchema } from './schemas/media-asset.schema';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';
import { WabaMessageModule } from 'src/whatsapp-embed/waba-message/waba-message.module';

@Module({
  imports: [
    HttpModule,
    forwardRef(() => UsersModule),
    ProjectsModule,
    WabaMessageModule,
    MongooseModule.forFeature([
      { name: MediaAsset.name, schema: MediaAssetSchema },
    ]),
  ],
  providers: [WhatsappService, CloudinaryService],
  exports: [WhatsappService],
  controllers: [WhatsappController],
})
export class WhatsappModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthAdminTokenMiddleware)
      .exclude({ path: 'whatsapp/webhook', method: RequestMethod.ALL })
      .forRoutes(WhatsappController);
  }
}
