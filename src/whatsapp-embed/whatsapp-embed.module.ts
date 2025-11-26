import { Module } from '@nestjs/common';
import { CampaignModule } from './campaign/campaign.module';
import { WabaMessageModule } from './waba-message/waba-message.module';
import { ApiCampaignModule } from './api-campaign/api-campaign.module';

@Module({
  imports: [CampaignModule, WabaMessageModule, ApiCampaignModule],
  exports: [CampaignModule, WabaMessageModule, ApiCampaignModule],
})
export class WhatsappEmbedModule {}
