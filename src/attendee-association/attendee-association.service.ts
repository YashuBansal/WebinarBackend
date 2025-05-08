import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { AttendeeLogService } from 'src/attendee-log/attendee-log.service';
import { AttendeeAssociation } from 'src/schemas/attendee-association.schema';
import { AttendeeAction } from 'src/schemas/attendee-logs.schema';

@Injectable()
export class AttendeeAssociationService {
  constructor(
    @InjectModel(AttendeeAssociation.name)
    private readonly attendeeAssociationModel: Model<AttendeeAssociation>,
    private readonly attendeeLogService: AttendeeLogService,
  ) {}

  async createAssociation(
    email: string,
    adminId: Types.ObjectId,
    leadTypeId: Types.ObjectId,
    leadTypeLabel: string,
    createdBy: string,
  ): Promise<AttendeeAssociation> {
    const updatedAssociation =
      await this.attendeeAssociationModel.findOneAndUpdate(
        { email, adminId },
        {
          $set: {
            leadType: new Types.ObjectId(`${leadTypeId}`), 
          },
        },
        {
          upsert: true,
          new: true, // return the updated or inserted document
          setDefaultsOnInsert: true, // applies schema defaults on insert
        },
      );

    if (updatedAssociation) {
      this.attendeeLogService.createSingleAttendeeLog({
        attendee: email,
        item: '',
        action: AttendeeAction.LEAD_TYPE,
        details: `Lead Type Updated by ${createdBy} : ${leadTypeLabel}.`,
        adminId: new Types.ObjectId(`${adminId}`)
     })
    }
    return updatedAssociation;
  }

  async getAssociation(
    adminId: Types.ObjectId,
    email: string,
  ): Promise<AttendeeAssociation> {
    const association = await this.attendeeAssociationModel
      .findOne({ adminId: new Types.ObjectId(`${adminId}`), email: email })
      .exec();
    return association ? association : null;
  }

  async deleteAttendeeAssociationsByAttendeeEmails(
    session: ClientSession,
    adminId: Types.ObjectId,
    attendees: string[],
  ) {
    console.log('attendee-association -> deleted');
    return this.attendeeAssociationModel
      .deleteMany({
        adminId: adminId,
        attendee: { $in: attendees },
      })
      .session(session)
      .exec();
  }
}
