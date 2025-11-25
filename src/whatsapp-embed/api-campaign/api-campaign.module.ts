import { MiddlewareConsumer, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ApiCampaignController } from './api-campaign.controller';
import { ApiCampaignService } from './api-campaign.service';
import {
  ApiCampaign,
  ApiCampaignSchema,
} from './api-campaign.schema';
import { AuthAdminTokenMiddleware } from '../../middlewares/authAdmin.Middleware';
import { UsersModule } from 'src/users/users.module';
import { WhatsappModule } from 'src/whatsapp/whatsapp.module';
import { WabaMessageModule } from '../waba-message/waba-message.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ApiCampaign.name, schema: ApiCampaignSchema },
    ]),
    WhatsappModule,
    UsersModule,
    WabaMessageModule
  ],
  controllers: [ApiCampaignController],
  providers: [ApiCampaignService],
  exports: [ApiCampaignService],
})
export class ApiCampaignModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthAdminTokenMiddleware)
      .forRoutes(ApiCampaignController);
  }
}

