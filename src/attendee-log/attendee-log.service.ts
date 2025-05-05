import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AttendeeLog } from 'src/schemas/attendee-logs.schema';

@Injectable()
export class AttendeeLogService {
  constructor(
    @InjectModel(AttendeeLog.name) private attendeeModel: Model<AttendeeLog>,
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
    const attendeeLog = new this.attendeeModel({
      attendee,
      action,
      item,
      details,
      adminId,
    });

    return await attendeeLog.save();
  }

  async fetchAttendeeLogsByAttendee(email: string) {
    return await this.attendeeModel
      .find({ attendee: email })
      .sort({ createdAt: -1 });
  }
}
