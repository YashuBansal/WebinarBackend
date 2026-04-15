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
import { WhatsappModule } from 'src/whatsapp/whatsapp.module';
import { SubscriptionModule } from 'src/subscription/subscription.module';
import { ConfigService } from '@nestjs/config';
import { AttendeeLogModule } from 'src/attendee-log/attendee-log.module';
import { WebsocketModule } from 'src/websocket/websocket.module';
import { GetAdminIdMiddleware } from 'src/middlewares/get-admin-id.middleware';
import { AlarmWhatsappConfigModule } from 'src/alarm-whatsapp-config/alarm-whatsapp-config.module';
import { AttendeeAssociationModule } from 'src/attendee-association/attendee-association.module';

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

    AttendeeLogModule,
    WebsocketModule,
    forwardRef(() => AlarmWhatsappConfigModule),
    forwardRef(() => AttendeeAssociationModule),
  ],
  controllers: [AlarmController],
  providers: [AlarmService, SchedulerRegistry, ConfigService],
  exports: [AlarmService],
})
export class AlarmModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthTokenMiddleware)
      .exclude({ path: 'alarm', method: RequestMethod.POST })
      .forRoutes({ path: 'alarm', method: RequestMethod.ALL });

    consumer
      .apply(GetAdminIdMiddleware)
      .forRoutes({ path: 'alarm', method: RequestMethod.POST });
  }
}
