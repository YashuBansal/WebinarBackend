import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { CreateAttendeeDto } from 'src/attendees/dto/attendees.dto';
import { AttendeeAction, AttendeeLog } from 'src/schemas/attendee-logs.schema';
import { FetchAttendeeLogDTO } from './dto/attendee-log.dto';

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

  async createAttendeeLogs(
    data: {
      attendee: string;
      action: string;
      item?: string;
      details: string;
      adminId: Types.ObjectId;
    }[],
    session?: ClientSession,
  ) {
    return await this.attendeeLogModel.insertMany(data, { session });
  }

  async fetchAttendeeLogsByAttendee(
    email: string,
    adminId: Types.ObjectId,
    filterDto: FetchAttendeeLogDTO, // Accept the DTO
  ) {
    const query: any = {
      attendee: email,
      adminId: adminId,
    };

    // Add action filter if provided
    if (filterDto.action) {
      query.action = filterDto.action; // Mongoose will handle the Enum value
    }

    // Add date range filter if start or end date is provided
    const createdAtFilter: any = {};
    if (filterDto.startDate) {
      // $gte: greater than or equal to the start date (at the beginning of the day)
      createdAtFilter.$gte = new Date(filterDto.startDate);
    }
    if (filterDto.endDate) {
      // $lt: less than the start of the *next* day to include the entire end day
      // Example: endDate '2023-10-26' means filter for createdAt < new Date('2023-10-27')
      createdAtFilter.$lt = new Date(filterDto.endDate);
    }

    // Merge createdAt filter into the main query if it's not empty
    if (Object.keys(createdAtFilter).length > 0) {
      query.createdAt = createdAtFilter;
    }

    // Parse pagination parameters with defaults and minimums
    const page = parseInt(filterDto.page, 10) || 1;
    const limit = parseInt(filterDto.limit, 10) || 10; // Default limit, e.g., 10 or 20
    const skip = (Math.max(1, page) - 1) * limit; // Ensure page is at least 1

    // 1. Get the total count of documents matching the filters (before pagination)
    const total = await this.attendeeLogModel.countDocuments(query).exec();
    const totalPages = Math.ceil(total / limit);
    console.log(query);
    // 2. Get the paginated documents matching the filters
    const data = await this.attendeeLogModel
      .find(query) // Use the built query object
      .sort({ createdAt: -1 }) // Still sort by creation date descending
      .skip(skip) // Apply skip for pagination offset
      .limit(limit) // Apply limit for page size
      .exec(); // Execute the query

    return {
      data,
      pagination: {
        total, // Total number of documents matching the filters
        currentPage: page, // The requested/parsed current page number
        limit, // The requested/parsed limit per page
        totalPages,
      },
    };
  }

  async createMultipleAttendeeLog({
    attendees,
    adminId,
    webinarName,
    session,
    isAttended,
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
      details: `<span>Attendee has been added to the <strong>${webinarType}</strong> webinar : <strong>${webinarName}</strong></span>`,
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
      details: `<span>Attendee has been assigned to <strong>${empData.userName}</strong> in the <strong>${webinarType}</strong> webinar : <strong>${webinarName}</strong></span>`,
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
      details: `<span>Attendee has been assigned to <strong>${userName}</strong> in the <strong>${webinarType}</strong> webinar : <strong>${webinarName}</strong></span>`,
      adminId,
    });
  }
}
