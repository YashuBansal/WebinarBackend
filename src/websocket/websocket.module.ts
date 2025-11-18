import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { WebsocketGateway } from './websocket.gateway';
import { WhatsAppGateway } from './whatsapp.gateway';

@Module({
  imports: [
    ConfigModule,
    JwtModule.register({}), // JwtModule will use ConfigService internally for secrets
  ],
  providers: [WebsocketGateway, WhatsAppGateway ],
  exports: [WebsocketGateway, WhatsAppGateway],
})
export class WebsocketModule {}
