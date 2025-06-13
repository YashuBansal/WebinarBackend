import {
  Body,
  Controller,
  Get,
  NotAcceptableException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AlarmService } from './alarm.service';
import { AdminId, Id } from 'src/decorators/custom.decorator';
import { CreateAlarmDto, CreateNewAlarmDTO } from './dto/alarm.dto';
import { Types } from 'mongoose';

@Controller('alarm')
export class AlarmController {
  constructor(private readonly alarmService: AlarmService) {}

  @Post()
  async setAlarm(
    @Id() id: string,
    @AdminId() adminId: string,
    @Body() createAlarmDto: CreateNewAlarmDTO,
  ): Promise<any> {
    const result = await this.alarmService.createAlarm(
      createAlarmDto,
      new Types.ObjectId(`${id}`),
      new Types.ObjectId(`${adminId}`),
    );
    // const result = await this.alarmService.setAlarm(createAlarmDto);
    return result;
  }

  @Get()
  async getAttendeeAlarm(
    @Id() id: string,
    @Query() query: { email: string },
  ): Promise<any> {
    if (!query?.email)
      throw new NotAcceptableException('E-mail not provided in query.');
    const result = await this.alarmService.getAttendeeAlarm(id, query.email);
    return result;
  }

  @Get('user/:id')
  async getUserAlarms(
    @Param('id') id: string,
    @Query() query: { month: string; year: string },
  ): Promise<any> {
    const year = Number(query.year);
    const month = Number(query.month);
    if (year && month)
      return await this.alarmService.fetchAlarmsByMonthAndYear(id, month, year);
  }

  @Patch()
  async cancelAlarm(
    @Id() id: string,
    @AdminId() adminId: string,
    @Body('id') alarmId: string,
    @Body('createdBy') createdBy: string,
  ): Promise<any> {
    const result = await this.alarmService.cancelAlarm(
      alarmId,
      id,
      createdBy,
      new Types.ObjectId(`${adminId}`),
    );
    return result;
  }
}
