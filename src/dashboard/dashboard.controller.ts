import { Controller, Get, Param, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { Id } from 'src/decorators/custom.decorator';
import mongoose, { Types } from 'mongoose';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('superAdmin')
  async superAdminDashboard(
    @Query() query: { startDate: string; endDate: string },
  ): Promise<any> {
    const result = await this.dashboardService.superAdminDashboard(
      query.startDate,
      query.endDate,
    );
    return result;
  }

  @Get('admin')
  async getAdminDashboard(
    @Query() query: { startDate: string; endDate: string; webinarId: string },
    @Id() adminId: string,
  ): Promise<any> {
    const { startDate, endDate, webinarId } = query;
    const { startDate: start, endDate: end } =
      this.dashboardService.validateDate(startDate, endDate);
    return await this.dashboardService.fetchAdminDashboardData(
      start,
      end,
      new Types.ObjectId(`${adminId}`),
      mongoose.isValidObjectId(webinarId)
        ? new Types.ObjectId(webinarId)
        : undefined,
    );
  }

  @Get('employee')
  async getEmployeeDashboard(
    @Query()
    query: {
      startDate: string;
      endDate: string;
      webinarId: string;
      employeeId: string;
    },
    @Id() employee: string,
  ): Promise<any> {
    const { startDate, endDate, webinarId, employeeId } = query;
    const userId = mongoose.isValidObjectId(employeeId) ? employeeId : employee;
    const { startDate: start, endDate: end } =
      this.dashboardService.validateDate(startDate, endDate);
    return await this.dashboardService.fetchEmployeeDashboardData(
      start,
      end,
      new Types.ObjectId(`${userId}`),
      mongoose.isValidObjectId(webinarId)
        ? new Types.ObjectId(webinarId)
        : undefined,
    );
  }

  @Get('plans')
  async plansMetric(
    @Query() query: { startDate: string; endDate: string },
  ): Promise<any> {
    const result = await this.dashboardService.plansMetric(
      query.startDate,
      query.endDate,
    );
    return result;
  }

  @Get('users')
  async userRegisterationMetrics(
    @Query() query: { startDate: string; endDate: string },
  ): Promise<any> {
    const result = await this.dashboardService.userRegisterationMetrics(
      query.startDate,
      query.endDate,
    );
    return result;
  }

  @Get('revenue')
  async revenueMetrics(
    @Query() query: { startDate: string; endDate: string },
  ): Promise<any> {
    const result = await this.dashboardService.revenueMetrics(
      query.startDate,
      query.endDate,
    );
    return result;
  }
}
