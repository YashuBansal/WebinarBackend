import { Module } from '@nestjs/common';
import { CampaignModule } from './campaign/campaign.module';
import { WabaMessageModule } from './waba-message/waba-message.module';

@Module({
  imports: [CampaignModule, WabaMessageModule],
  exports: [CampaignModule, WabaMessageModule],
})
export class WhatsappEmbedModule {}
