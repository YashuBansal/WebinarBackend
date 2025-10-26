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
        details: `<span>Lead Type Updated by <strong>${createdBy}</strong> : <strong>${leadTypeLabel}</strong>.</span>`,
        adminId: new Types.ObjectId(`${adminId}`),
      });
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


  async addFullNamesAndPhonesToAssociation(
    payload: 
    {
      fullName: string,
      phone: string,
      adminId: Types.ObjectId,
      email: string,
    }
  ){
    const { fullName="", phone="", adminId, email } = payload;

    const association = await this.attendeeAssociationModel.findOne({ adminId: adminId, email: email });
    

    const trimmedFullName = fullName?.trim() || "";
    const trimmedPhone = phone?.trim() || "";

    if(!association){
      const newAssociation = await this.attendeeAssociationModel.create({
        email: email,
        adminId: adminId,
        fullNames: trimmedFullName ? [trimmedFullName] : [],
        phones: trimmedPhone ? [trimmedPhone] : [],
      });
      return newAssociation;
    }

    const associatedFullNames = association.fullNames || [];
    const associatedPhones = association.phones || [];

    // Add new full names and phones to the association but remove duplicates

    if(trimmedFullName && !associatedFullNames.includes(trimmedFullName)){
      associatedFullNames.push(trimmedFullName);
    }

    if(trimmedPhone && !associatedPhones.includes(trimmedPhone)){
      associatedPhones.push(trimmedPhone);
    }

    const updatedAssociation = await this.attendeeAssociationModel.updateOne(
      { adminId: adminId, email: email },
      { $set: { fullNames: associatedFullNames, phones: associatedPhones } },
    );

    return updatedAssociation;
  }

}
