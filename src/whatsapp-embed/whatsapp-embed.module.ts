import { Module } from '@nestjs/common';
import { CampaignModule } from './campaign/campaign.module';
import { WabaMessageModule } from './waba-message/waba-message.module';
import { ApiCampaignModule } from './api-campaign/api-campaign.module';
import { WabaTemplateModule } from './waba-template/waba-template.module';

@Module({
  imports: [
    CampaignModule,
    WabaMessageModule,
    ApiCampaignModule,
    WabaTemplateModule,
  ],
  exports: [
    CampaignModule,
    WabaMessageModule,
    ApiCampaignModule,
    WabaTemplateModule,
  ],
})
export class WhatsappEmbedModule {}
