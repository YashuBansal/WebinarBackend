import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Id } from 'src/decorators/custom.decorator';
import {
  DeleteAlarmWhatsappConfigDto,
  GetAlarmWhatsappConfigQueryDto,
  TestSendAlarmWhatsappConfigDto,
  ToggleAlarmWhatsappConfigDto,
  UpsertAlarmWhatsappConfigDto,
} from './dto';
import { AlarmWhatsappConfigService } from './alarm-whatsapp-config.service';
import mongoose from 'mongoose';

@Controller('alarm-whatsapp-config')
export class AlarmWhatsappConfigController {
  constructor(private readonly svc: AlarmWhatsappConfigService) {}

  @Get()
  @UsePipes(new ValidationPipe({ transform: true }))
  async getConfig(@Query() q: GetAlarmWhatsappConfigQueryDto, @Id() adminId: string) {
    const data = await this.svc.getConfig(adminId, q.projectId);
    return { statusCode: 200, message: 'ok', data };
  }

  @Get('all')
  async list(@Query('projectId') projectId: string, @Id() adminId: string) {
    if (
      projectId &&
      (!mongoose.isValidObjectId(projectId) || !mongoose.isValidObjectId(adminId))
    ) {
      return { statusCode: 400, message: 'Invalid projectId or adminId' };
    }
    const data = await this.svc.list(adminId, projectId);
    return { statusCode: 200, message: 'ok', data };
  }

  @Post()
  @UsePipes(new ValidationPipe({ transform: true }))
  async upsert(@Body() dto: UpsertAlarmWhatsappConfigDto, @Id() adminId: string) {
    const data = await this.svc.upsert(adminId, dto);
    return { statusCode: 200, message: 'saved', data };
  }

  @Post('test-send')
  @UsePipes(new ValidationPipe({ transform: true }))
  async testSend(
    @Body() dto: TestSendAlarmWhatsappConfigDto,
    @Id() adminId: string,
  ) {
    const data = await this.svc.sendTest(adminId, dto);
    return { statusCode: 200, message: 'sent', data };
  }

  @Delete()
  @UsePipes(new ValidationPipe({ transform: true }))
  async delete(@Query() q: DeleteAlarmWhatsappConfigDto, @Id() adminId: string) {
    const data = await this.svc.delete(adminId, q._id);
    return { statusCode: 200, message: 'deleted', data };
  }

  @Patch('toggle')
  @UsePipes(new ValidationPipe({ transform: true }))
  async toggle(@Body() dto: ToggleAlarmWhatsappConfigDto, @Id() adminId: string) {
    const data = await this.svc.toggle(adminId, dto._id, dto.enabled);
    return { statusCode: 200, message: 'toggled', data };
  }
}
