import { Injectable } from '@nestjs/common';
import {
  CreateUserActivityDto,
  InactiviUserDTO,
  UserActivityFilterDTO,
} from './dto/user-activity.dto';
import { InjectModel } from '@nestjs/mongoose';
import { UserActivity } from 'src/schemas/UserActivity.schema';
import { Model, PipelineStage, Types } from 'mongoose';
import { NotificationService } from 'src/notification/notification.service';
import {
  notificationActionType,
  notificationType,
} from 'src/schemas/notification.schema';
import { WebsocketGateway } from 'src/websocket/websocket.gateway';
import { SocketEvents } from 'src/websocket/dto/socket.dto';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class UserActivityService {
  constructor(
    @InjectModel(UserActivity.name)
    private readonly userActivityModel: Model<UserActivity>,
    private readonly notificationService: NotificationService,
    private readonly socketGateway: WebsocketGateway,
    private readonly configService: ConfigService,
  ) {}

  async addUserActivity(
    user: string,
    adminId: string,
    dto: CreateUserActivityDto,
    role: string,
  ) {
    if (!user || !adminId) {
      throw new Error('User ID and Admin ID are required.');
    }

    const activity = await this.userActivityModel.create({
      ...dto,
      user: new Types.ObjectId(user),
      adminId: new Types.ObjectId(adminId),
      action: dto.action,
      details: dto.details || '',
    });
    if (
      String(role) ===
        String(this.configService.get('appRoles')['EMPLOYEE_SALES']) ||
      String(role) ===
        String(this.configService.get('appRoles')['EMPLOYEE_REMINDER'])
    ) {
      console.log('emp event');
      this.socketGateway.emitSocketEvent(
        adminId,
        SocketEvents.EMPLOYEE_ACTIVITY_LOG,
        {
          activity,
        },
      );
    }
  }

  async getUserActivitiesByUser(
    userId: Types.ObjectId,
    page: number,
    limit: number,
    filters?: UserActivityFilterDTO,
  ): Promise<{
    data: UserActivity[];
    pagination: {
      totalActivities: number;
      totalPages: number;
      currentPage: number;
      pageSize: number; // Number of items on the current page
    };
  }> {
    // 1. Build the base query object
    // Standard filters go here
    const query: any = {
      // Using 'any' for flexibility, consider a more specific type if appropriate
      user: userId,
    };

    // 2. Add conditional filters

    // Filter by action (standard query operator)
    if (filters?.action) {
      query.action = filters.action; // Assuming exact match is desired
      // For partial match, you could use regex: query.action = new RegExp(filters.action, 'i');
    }

    // Filter by date range using $expr and $dateFromParts (as requested)
    const dateQueryConditions = [];

    if (filters?.fromDate) {
      // Create a Date object from the fromDate string.
      // new Date("YYYY-MM-DD") typically creates a Date object at UTC midnight.
      // This Date object will be compared against the date constructed by $dateFromParts.
      const startDateObj = new Date(filters.fromDate);
      if (!isNaN(startDateObj.getTime())) {
        // Check if the date string was valid
        dateQueryConditions.push({
          $gte: [
            {
              // Construct the date part of the 'createdAt' field in 'Asia/Kolkata' timezone
              $dateFromParts: {
                year: {
                  $year: { date: '$createdAt', timezone: 'Asia/Kolkata' },
                },
                month: {
                  $month: { date: '$createdAt', timezone: 'Asia/Kolkata' },
                },
                day: {
                  $dayOfMonth: { date: '$createdAt', timezone: 'Asia/Kolkata' },
                },
                timezone: 'Asia/Kolkata', // This timezone seems redundant here but matches snippet
              },
            },
            startDateObj, // Compare against the start date Date object (UTC midnight)
          ],
        });
      } else {
        console.warn(
          `Invalid fromDate string provided: ${filters.fromDate}. Skipping $gte date filter.`,
        );
      }
    }

    if (filters?.toDate) {
      // Create a Date object from the toDate string.
      const endDateObj = new Date(filters.toDate);
      if (!isNaN(endDateObj.getTime())) {
        // Check if the date string was valid
        // To include the *entire* end day using this date-part comparison,
        // we check if the createdAt's *date part* is LESS THAN OR EQUAL TO
        // the date part of the toDate.
        dateQueryConditions.push({
          $lte: [
            {
              // Construct the date part of the 'createdAt' field in 'Asia/Kolkata' timezone
              $dateFromParts: {
                year: {
                  $year: { date: '$createdAt', timezone: 'Asia/Kolkata' },
                },
                month: {
                  $month: { date: '$createdAt', timezone: 'Asia/Kolkata' },
                },
                day: {
                  $dayOfMonth: { date: '$createdAt', timezone: 'Asia/Kolkata' },
                },
                timezone: 'Asia/Kolkata', // Redundant but matches snippet
              },
            },
            endDateObj, // Compare against the end date Date object (UTC midnight)
          ],
        });
      } else {
        console.warn(
          `Invalid toDate string provided: ${filters.toDate}. Skipping $lte date filter.`,
        );
      }
    }

    // If any date conditions were added, combine them with $and and add to the query using $expr
    if (dateQueryConditions.length > 0) {
      query.$expr = { $and: dateQueryConditions };
    }

    // Calculate skip for pagination
    const skip = (page - 1) * limit;

    // 3. Fetch activities with the constructed filters and pagination
    const activities = await this.userActivityModel
      .find(query) // Use the query object with standard and $expr filters
      .sort({ createdAt: -1 }) // Sort by creation date descending
      .skip(skip) // Apply skip for pagination
      .limit(limit) // Apply limit for pagination
      .select('action details createdAt updatedAt item')
      .lean(); // Select desired fields

    // 4. Get total count with the same filters
    // It's crucial to use the *same* query object for countDocuments
    const totalActivities = await this.userActivityModel.countDocuments(query);

    return {
      data: activities,
      pagination: {
        totalActivities: totalActivities,
        totalPages: Math.ceil(totalActivities / limit),
        currentPage: page,
        pageSize: activities.length, // Use the actual number of items returned on this page
      },
    };
  }

  async sendInactivityNotification(adminId: string, body: InactiviUserDTO) {
    const notification = {
      recipient: adminId,
      title: 'User Inactivity Alert',
      message: `User ${body.userName} (${body.email}) has been inactive for ${body.seconds} seconds.`,
      type: notificationType.INFO,
      actionType: notificationActionType.USER_ACTIVITY,
      metadata: {
        userId: body.userId,
        email: body.email,
        userName: body.userName,
        role: body.role,
      },
    };

    await this.notificationService.createNotification(notification);

    return [];
  }

  async getUserActivitiesByAdmin(
    adminId: string,
    email?: string,
    page: number = 1,
    limit: number = 10,
  ) {
    const skip = (page - 1) * limit;
    const query: any = {
      $or: [
        { adminId: new Types.ObjectId(adminId) },
        { user: new Types.ObjectId(adminId) },
      ],
      ...(email ? { item: email } : {}),
    };

    const activities = await this.userActivityModel
      .find(query)
      .populate('user', 'userName email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalLogs = await this.userActivityModel.countDocuments(query);

    return {
      data: activities,
      pagination: {
        totalLogs,
        totalPages: Math.ceil(totalLogs / limit),
        currentPage: page,
        pageSize: activities.length,
      },
      message: 'User activities retrieved',
    };
  }

  async getUserActivityOfEmployees(adminId: Types.ObjectId) {
    const pipeline: PipelineStage[] = [
      {
        $match: {
          adminId,
        },
      },
      {
        $sort: {
          createdAt: -1,
        },
      },
      {
        $group: {
          _id: '$user',
          actions: {
            $first: {
              action: '$action',
              details: '$details',
              createdAt: '$createdAt',
              updatedAt: '$updatedAt',
            },
          },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'userDetails',
        },
      },
      {
        $unwind: {
          path: '$userDetails',
          preserveNullAndEmptyArrays: false,
        },
      },
      {
        $lookup: {
          from: 'roles',
          localField: 'userDetails.role',
          foreignField: '_id',
          as: 'roleDetails',
        },
      },
      {
        $project: {
          _id: 1,
          userEmail: '$userDetails.email',
          userRole: { $arrayElemAt: ['$roleDetails.name', 0] },
          action: '$actions.action',
          details: '$actions.details',
          createdAt: '$actions.createdAt',
          updatedAt: '$actions.updatedAt',
        },
      },
      {
        $sort: {
          userEmail: 1,
        },
      },
    ];

    const employees = await this.userActivityModel.aggregate(pipeline).exec();
    employees.forEach((employee) => {
      if (this.socketGateway.activeUsers.has(employee._id.toString())) {
        employee['isOnline'] = true;
      } else {
        employee['isOnline'] = false;
      }
    });
    return employees;
  }
}
