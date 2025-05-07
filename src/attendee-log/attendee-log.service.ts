import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { CreateAttendeeDto } from 'src/attendees/dto/attendees.dto';
import { AttendeeAction, AttendeeLog } from 'src/schemas/attendee-logs.schema';

@Injectable()
export class AttendeeLogService {
  constructor(
    @InjectModel(AttendeeLog.name) private attendeeLogModel: Model<AttendeeLog>,
  ) {}

  async createSingleAttendeeLog({
    attendee,
    action,
    item,
    details,
    adminId,
  }: {
    attendee: string;
    action: string;
    item?: string;
    details: string;
    adminId: Types.ObjectId;
  }) {
    const attendeeLog = new this.attendeeLogModel({
      attendee,
      action,
      item,
      details,
      adminId,
    });

    return await attendeeLog.save();
  }

  async fetchAttendeeLogsByAttendee(email: string) {
    return await this.attendeeLogModel
      .find({ attendee: email })
      .sort({ createdAt: -1 });
  }

  async createMultipleAttendeeLog({
    attendees,
    adminId,
    webinarName,
    session,
  }: {
    attendees: CreateAttendeeDto[];
    webinarName: string;
    session: ClientSession;
    adminId: Types.ObjectId;
  }) {
    if (!webinarName) return;
    const attendeeLogs = attendees.map((attendee) => ({
      attendee: attendee.email,
      action: AttendeeAction.ADDED,
      item: webinarName,
      details: `Attendee ${attendee.email} has been added to the webinar : ${webinarName}`,
      adminId,
    }));

    return await this.attendeeLogModel.insertMany(attendeeLogs, { session });
  }
}
