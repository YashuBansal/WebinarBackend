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
    isAttended
  }: {
    attendees: CreateAttendeeDto[];
    webinarName: string;
    session: ClientSession;
    adminId: Types.ObjectId;
    isAttended: boolean;
  }) {
    if (!webinarName) return;

    const webinarType = isAttended ? 'Sales' : 'Reminder';

    const attendeeLogs = attendees.map((attendee) => ({
      attendee: attendee.email,
      action: AttendeeAction.ADDED,
      item: webinarName,
      details: `Attendee has been added to the ${webinarType} webinar : ${webinarName}`,
      adminId,
    }));

    return await this.attendeeLogModel.insertMany(attendeeLogs, { session });
  }

  async createMultipleAssignmentsLog(
    empData: {
      userName?: string;
      attendees?: { email: string }[];
    },
    webinarName: string,
    adminId: Types.ObjectId,
    session: ClientSession,
    isAttended: boolean,
  ) {
    if (!webinarName || !empData.attendees || !Array.isArray(empData.attendees))
      return;

    const webinarType = isAttended ? 'Sales' : 'Reminder';

    const attendeeLogs = empData.attendees.map((attendee) => ({
      attendee: attendee.email,
      action: AttendeeAction.ASSIGNMENT,
      item: webinarName,
      details: `Attendee has been assigned to ${empData.userName} in the ${webinarType} webinar : ${webinarName}`,
      adminId,
    }));

    return await this.attendeeLogModel.insertMany(attendeeLogs, { session });
  }

  async createAssignmentsLog(
    userName: string,
    email: string,
    webinarName: string,
    adminId: Types.ObjectId,
    isAttended: boolean,
  ) {
    if (!webinarName || !userName || !email) return;

    const webinarType = isAttended ? 'Sales' : 'Reminder';

    return await this.attendeeLogModel.create({
      attendee: email,
      action: AttendeeAction.ASSIGNMENT,
      item: webinarName,
      details: `Attendee has been assigned to ${userName} in the ${webinarType} webinar : ${webinarName}`,
      adminId,
    })
  }
}
