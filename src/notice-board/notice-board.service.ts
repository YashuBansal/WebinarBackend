import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { NoticeBoard } from '../schemas/notice-board.schema';
import { UsersService } from 'src/users/users.service';
import { NotificationService } from 'src/notification/notification.service';
import {
  notificationActionType,
  notificationType,
} from 'src/schemas/notification.schema';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class NoticeBoardService {
  constructor(
    @InjectModel(NoticeBoard.name) private noticeBoardModel: Model<NoticeBoard>,
    private readonly userService: UsersService,
    private readonly notificationService: NotificationService,
    private readonly configService: ConfigService,
  ) {}

  async sendNotificationsToEmployees(
    adminId: Types.ObjectId,
    notice: NoticeBoard,
  ) {
    const employees =
      (await this.userService.getEmployeesForNotes(adminId)) || [];

    let role = '';

    if( notice.type === 'sales') {
      role = this.configService.get('appRoles')['EMPLOYEE_SALES'];
    } else if (notice.type === 'reminder') {
      role = this.configService.get('appRoles')['EMPLOYEE_REMINDER'];
    }
    console.log('Role:', role);
    

    for (const employee of employees) {
      console.log('Employee:', employee.role, employee.isActive, employee.userName);
      if (employee.isActive && String(employee.role) === role) {
        const notification = {
          recipient: String(employee._id),
          title: 'Notice Board Updated',
          message: `The notice Board has been updated. Please check the notice board for details.`,
          type: notificationType.INFO,
          actionType: notificationActionType.NOTICE_BOARD_UPDATE,
          metadata: {
            notice,
          },
        };

        await this.notificationService.createNotification(notification);
      }
    }
  }

  // Create or Update the notice board
  async createOrUpdate(
    adminId: Types.ObjectId,
    content: string,
    type: string,
  ): Promise<NoticeBoard> {
    // Try to find a notice by type
    let notice = await this.noticeBoardModel.findOne({ adminId, type }).exec();

    if (notice) {
      // If notice exists, update it
      notice.content = content;
      await notice.save();
    } else {
      // If no notice exists, create a new one
      notice = new this.noticeBoardModel({ adminId, content, type });
      await notice.save();
    }

    this.sendNotificationsToEmployees(adminId, notice);

    return notice;
  }

  // Get the current notice board content
  async find(adminId: Types.ObjectId, type: string): Promise<NoticeBoard> {
    const notice = await this.noticeBoardModel.findOne({ adminId, type }).exec();

    return notice ? notice : null;
  }
}
