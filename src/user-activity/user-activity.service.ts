import { Injectable } from '@nestjs/common';
import {
  CreateUserActivityDto,
  InactiviUserDTO,
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

@Injectable()
export class UserActivityService {
  constructor(
    @InjectModel(UserActivity.name)
    private readonly userActivityModel: Model<UserActivity>,
    private readonly notificationService: NotificationService,
    private readonly socketGateway: WebsocketGateway,
  ) {}

  async addUserActivity(
    user: string,
    adminId: string,
    dto: CreateUserActivityDto,
  ) {
    if (!user || !adminId) {
      throw new Error('User ID and Admin ID are required.');
    }

    return this.userActivityModel.create({
      ...dto,
      user: new Types.ObjectId(user),
      adminId: new Types.ObjectId(adminId),
      action: dto.action,
      details: dto.details || '',
    });
  }

  async getUserActivitiesByUser(
    userId: Types.ObjectId,
    page: number,
    limit: number,
  ) {
    const skip = (page - 1) * limit;

    const activities = await this.userActivityModel
      .find({ user: userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('action details createdAt updatedAt');

    const totalActivities = await this.userActivityModel.countDocuments({
      user: userId,
    });

    return {
      data: activities,
      pagination: {
        totalActivities,
        totalPages: Math.ceil(totalActivities / limit),
        currentPage: page,
        pageSize: activities.length,
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
        $project: {
          _id: 1,
          userEmail: { $arrayElemAt: ['$userDetails.email', 0] },
          action: '$actions.action',
          details: '$actions.details',
          createdAt: '$actions.createdAt',
          updatedAt: '$actions.updatedAt',
        },
      },
      {
        $sort: {
          userEmail: 1,
        }
      }
    ];

    const employees = await this.userActivityModel.aggregate(pipeline).exec();
    employees.forEach((employee) => {
      if(this.socketGateway.activeUsers.has(employee._id.toString())){
        employee['isOnline'] = true;
      }
      else{
        employee['isOnline'] = false;
      }
      
    })
    return employees;
  }
}
