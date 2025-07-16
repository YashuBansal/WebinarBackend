import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { WebinarParticipant } from 'src/schemas/webinar-participant.schema';
import { CreateWebinarParticipantDto } from './dto/webinar-participant.dto';

@Injectable()
export class WebinarParticipantService {
  constructor(
    @InjectModel(WebinarParticipant.name)
    private webinarParticipantModel: Model<WebinarParticipant>,
  ) {}

  async createMany(
    createParticipantDtos: CreateWebinarParticipantDto[],
    adminId: Types.ObjectId,
    webinarId: Types.ObjectId,
    session: ClientSession,
  ) {
    if (!createParticipantDtos || createParticipantDtos.length === 0) {
      return [];
    }

    const allLastNamesBlank = createParticipantDtos.every(
      (attendee) => !attendee.lastName || attendee.lastName.trim() === '',
    );

    const someFirstNamePresent = createParticipantDtos.some(
      (attendee) => attendee.firstName && attendee.firstName.trim() !== '',
    );

    if (allLastNamesBlank && someFirstNamePresent) {
      createParticipantDtos.forEach((attendee) => {
        if (attendee.firstName && attendee.firstName.trim() !== '') {
          const parts = attendee.firstName.trim().split(' ');
          attendee.firstName = parts[0];
          attendee.lastName = parts.slice(1).join(' ') || '';
        }
      });
    }
    try {
      const deletedParticipants = await this.webinarParticipantModel.deleteMany(
        {
          adminId: adminId,
          webinar: webinarId,
        },
        {
          session,
        },
      );

      const createdParticipants = await this.webinarParticipantModel.insertMany(
        createParticipantDtos.filter((item) => item.inTime && item.outTime),
        {
          session,
        },
      );
      return createdParticipants;
    } catch (error) {
      console.error('Error creating many webinar participants:', error);
      throw new InternalServerErrorException(
        'Failed to create multiple webinar participants due to a server error.',
      );
    }
  }

  async findByAdminAndWebinar(
    adminId: Types.ObjectId,
    webinarId: Types.ObjectId,
  ): Promise<WebinarParticipant[]> {
    try {
      const queryAdminId = adminId;
      const queryWebinarId = webinarId;

      return await this.webinarParticipantModel
        .find({
          adminId: queryAdminId,
          webinar: queryWebinarId,
        })
        .select('email firstName lastName inTime outTime')
        .exec();
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      console.error(
        `Error fetching participants for Admin ID ${adminId} and Webinar ID ${webinarId}:`,
        error,
      );
      throw new InternalServerErrorException(
        'Failed to retrieve participants due to a server error.',
      );
    }
  }
}
