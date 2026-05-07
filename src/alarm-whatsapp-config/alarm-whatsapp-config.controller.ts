import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import { UsersService } from 'src/users/users.service';

@Controller('alarm-whatsapp-config')
export class AlarmWhatsappConfigController {
  private readonly allowedEmails = new Set([
    'anukulsaxena83@gmail.com',
    'ritikbansalrrb@gmail.com',
  ]);

  constructor(
    private readonly svc: AlarmWhatsappConfigService,
    private readonly usersService: UsersService,
  ) {}

  private async assertAllowedUser(id: string) {
    const user = await this.usersService.getUserById(id);
    const email = String(user?.email || '')
      .trim()
      .toLowerCase();
    if (!this.allowedEmails.has(email)) {
      throw new ForbiddenException(
        'You are not authorized to manage alarm WhatsApp configuration',
      );
    }
    return email;
  }

  @Get()
  @UsePipes(new ValidationPipe({ transform: true }))
  async getConfig(@Query() q: GetAlarmWhatsappConfigQueryDto, @Id() id: string) {
    await this.assertAllowedUser(id);
    const data = await this.svc.getConfig(q.projectId);
    return { statusCode: 200, message: 'ok', data };
  }

  @Get('all')
  async list(@Query('projectId') projectId: string, @Id() id: string) {
    await this.assertAllowedUser(id);
    if (
      projectId &&
      !mongoose.isValidObjectId(projectId)
    ) {
      return { statusCode: 400, message: 'Invalid projectId' };
    }
    const data = await this.svc.list(projectId);
    return { statusCode: 200, message: 'ok', data };
  }

  @Post()
  @UsePipes(new ValidationPipe({ transform: true }))
  async upsert(@Body() dto: UpsertAlarmWhatsappConfigDto, @Id() id: string) {
    const ownerEmail = await this.assertAllowedUser(id);
    const data = await this.svc.upsert(id, ownerEmail, dto);
    return { statusCode: 200, message: 'saved', data };
  }

  @Post('test-send')
  @UsePipes(new ValidationPipe({ transform: true }))
  async testSend(
    @Body() dto: TestSendAlarmWhatsappConfigDto,
    @Id() id: string,
  ) {
    await this.assertAllowedUser(id);
    const data = await this.svc.sendTest(dto);
    return { statusCode: 200, message: 'sent', data };
  }

  @Delete()
  @UsePipes(new ValidationPipe({ transform: true }))
  async delete(@Query() q: DeleteAlarmWhatsappConfigDto, @Id() id: string) {
    await this.assertAllowedUser(id);
    const data = await this.svc.delete(q._id);
    return { statusCode: 200, message: 'deleted', data };
  }

  @Patch('toggle')
  @UsePipes(new ValidationPipe({ transform: true }))
  async toggle(@Body() dto: ToggleAlarmWhatsappConfigDto, @Id() id: string) {
    await this.assertAllowedUser(id);
    const data = await this.svc.toggle(dto._id, dto.enabled);
    return { statusCode: 200, message: 'toggled', data };
  }
}
