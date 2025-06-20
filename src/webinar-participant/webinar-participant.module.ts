import { Module } from '@nestjs/common';
import { WebinarParticipantService } from './webinar-participant.service';
import { WebinarParticipantController } from './webinar-participant.controller';
import { MongooseModule } from '@nestjs/mongoose';
import {
  WebinarParticipant,
  WebinarParticipantSchema,
} from 'src/schemas/webinar-participant.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: WebinarParticipant.name,
        schema: WebinarParticipantSchema,
      },
    ]),
  ],
  providers: [WebinarParticipantService],
  controllers: [WebinarParticipantController],
  exports: [WebinarParticipantService],
})
export class WebinarParticipantModule {}
