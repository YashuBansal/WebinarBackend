import { MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';
import { CampaignController } from './campaign.controller';
import { CampaignService } from './campaign.service';
import {
  Campaign,
  CampaignSchema,
} from './campaign.schema';
import { WabaMessageModule } from '../waba-message/waba-message.module';
import { ProjectsModule } from '../../projects/projects.module';
import { AuthAdminTokenMiddleware } from '../../middlewares/authAdmin.Middleware';
import { UsersModule } from 'src/users/users.module';
import { forwardRef } from '@nestjs/common';
import { WhatsappModule } from 'src/whatsapp/whatsapp.module';
import { AttendeesModule } from 'src/attendees/attendees.module';
import { ContactsModule } from 'src/contacts/contacts.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Campaign.name, schema: CampaignSchema },
    ]),
    HttpModule,
    WabaMessageModule,
    ProjectsModule,
     forwardRef(() => UsersModule),
     WhatsappModule,
     AttendeesModule,
     ContactsModule
  ],
  controllers: [CampaignController],
  providers: [CampaignService],
  exports: [CampaignService],
})
export class CampaignModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthAdminTokenMiddleware)
      .exclude({ path: 'campaign/webhook', method: RequestMethod.ALL })
      .forRoutes(CampaignController);
  }
}
