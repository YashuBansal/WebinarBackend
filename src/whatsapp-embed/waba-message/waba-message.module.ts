import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WabaMessageService } from './waba-message.service';
import { WabaMessage, WabaMessageSchema } from '../../schemas/whatsapp-embed/waba-message.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WabaMessage.name, schema: WabaMessageSchema },
    ]),
  ],
  providers: [WabaMessageService],
  exports: [WabaMessageService],
})
export class WabaMessageModule {}
