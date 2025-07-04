// user-activity.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { AdminId, Id, Role } from 'src/decorators/custom.decorator';
import {
  CreateUserActivityDto,
  InactiviUserDTO,
  UserActivityFilterDTO,
} from './dto/user-activity.dto';
import { UserActivityService } from './user-activity.service';
import mongoose, { Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { UsersService } from 'src/users/users.service';

@Controller('user-activities')
export class UserActivityController {
  constructor(
    private readonly userActivityService: UserActivityService,
    private readonly configService: ConfigService,
    private readonly userService: UsersService
  ) {}

  @Post()
  async addUserActivity(
    @Body() dto: CreateUserActivityDto,
    @AdminId() adminId: string,
    @Id() id: string,
    @Role() role: string
  ) {
    const newLog = await this.userActivityService.addUserActivity(
      id,
      adminId,
      dto,
      role
    );

    return {
      statusCode: 201,
      message: 'User activity log added successfully.',
      data: newLog,
    };
  }

  @Get('employee')
  async getUserActivityOfEmployees(@Id() id: string) {
    if (!id || !mongoose.isValidObjectId(id)) {
      throw new BadRequestException('User ID is required.');
    }
    return await this.userService.getUserActivityOfEmployees(
      new Types.ObjectId(`${id}`),
    );
  }

  @Get(':userId')
  async getUserActivitiesByUser(
    @Req() req: Request,
    @Param('userId') userId: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('filters') filters?: UserActivityFilterDTO,
  ) {
    if (!userId || !mongoose.isValidObjectId(userId)) {
      throw new BadRequestException('User ID is required.');
    }
    console.log();

    const activities = await this.userActivityService.getUserActivitiesByUser(
      new Types.ObjectId(`${userId}`),
      parseInt(page) || 1,
      parseInt(limit) || 10,
      filters,
    );

    return {
      message: 'User activities for specified user ID',
      data: activities.data,
      pagination: activities.pagination,
    };
  }

  @Get()
  async getUserActivities(
    @Req() req: Request,
    @AdminId() adminId: string,
    @Role() role: string,
    @Id() id: string,
    @Query('email') email: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    let admin = '';
    const clientRoleId = this.configService.get('appRoles').ADMIN;

    if (role === clientRoleId) {
      admin = id;
    } else {
      admin = adminId;
    }
    return await this.userActivityService.getUserActivitiesByAdmin(
      admin,
      email,
      parseInt(page) || 1,
      parseInt(limit) || 10,
    );
  }

  @Put('inactive')
  async sendInactiveEmail(
    @AdminId() adminId: string,
    @Body() body: InactiviUserDTO,
  ) {
    // const admin = await this.userService.getUserById(adminId);
    // if(!admin){
    //   throw new NotFoundException('Admin not found');
    // }
    return await this.userActivityService.sendInactivityNotification(
      adminId,
      body,
    );
  }
}
