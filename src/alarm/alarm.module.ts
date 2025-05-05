import {
  forwardRef,
  MiddlewareConsumer,
  Module,
  RequestMethod,
} from '@nestjs/common';
import { AlarmController } from './alarm.controller';
import { AlarmService } from './alarm.service';
import { AuthTokenMiddleware } from 'src/middlewares/authToken.Middleware';
import { MongooseModule } from '@nestjs/mongoose';
import { Alarm, AlarmSchema } from 'src/schemas/Alarm.schema';
import { SchedulerRegistry } from '@nestjs/schedule';
import { WebsocketGateway } from 'src/websocket/websocket.gateway';
import { WhatsappModule } from 'src/whatsapp/whatsapp.module';
import { SubscriptionModule } from 'src/subscription/subscription.module';
import { ConfigService } from '@nestjs/config';
import { AttendeeLogModule } from 'src/attendee-log/attendee-log.module';

@Module({
  imports: [
    forwardRef(() => WhatsappModule),
    MongooseModule.forFeature([
      {
        name: Alarm.name,
        schema: AlarmSchema,
      },
    ]),
    forwardRef(() => SubscriptionModule),

    AttendeeLogModule

    
  ],
  controllers: [AlarmController],
  providers: [AlarmService, WebsocketGateway, SchedulerRegistry, ConfigService],
  exports: [AlarmService],
})
export class AlarmModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthTokenMiddleware)
      .forRoutes({ path: 'alarm', method: RequestMethod.ALL });
  }
}
