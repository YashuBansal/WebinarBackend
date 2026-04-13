import { MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthAdminTokenMiddleware } from 'src/middlewares/authAdmin.Middleware';
import {
  WhatsappOptout,
  WhatsappOptoutSchema,
} from 'src/whatsapp/schemas/whatsapp-optout.schema';
import { WhatsappOptoutController } from './whatsapp-optout.controller';
import { WhatsappOptoutService } from './whatsapp-optout.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WhatsappOptout.name, schema: WhatsappOptoutSchema },
    ]),
  ],
  controllers: [WhatsappOptoutController],
  providers: [WhatsappOptoutService],
  exports: [WhatsappOptoutService],
})
export class WhatsappOptoutModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthAdminTokenMiddleware)
      .forRoutes({ path: 'whatsapp-optout', method: RequestMethod.ALL });
  }
}
