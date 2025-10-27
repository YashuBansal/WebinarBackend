import { Body, Controller, Delete, Get, Post, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { WebinarAutoMessageService } from './webinar-auto-message.service';
import { UpsertAutoMessageDto, GetConfigQueryDto, TestSendDto, DeleteAutoMessageDto } from './dto';
import { Id } from '../decorators/custom.decorator';

@Controller('webinar-auto-message')
export class WebinarAutoMessageController {
  constructor(private readonly svc: WebinarAutoMessageService) {}

  @Get()
  @UsePipes(new ValidationPipe({ transform: true }))
  async getConfig(@Query() q: GetConfigQueryDto, @Id() adminId: string) {
    const data = await this.svc.getConfig(adminId, q.webinarId);
    return { statusCode: 200, message: 'ok', data };
  }

  @Get('all')
  async list(@Query('projectId') projectId: string, @Id() adminId: string) {
    const data = await this.svc.list(adminId, projectId);
    return { statusCode: 200, message: 'ok', data };
  }

  @Post()
  @UsePipes(new ValidationPipe({ transform: true }))
  async upsert(@Body() dto: UpsertAutoMessageDto, @Id() adminId: string) {
    const data = await this.svc.upsert(adminId, dto);
    return { statusCode: 200, message: 'saved', data };
  }

  @Post('test-send')
  @UsePipes(new ValidationPipe({ transform: true }))
  async testSend(@Body() dto: TestSendDto, @Id() adminId: string) {
    const data = await this.svc.sendTest(adminId, dto);
    return { statusCode: 200, message: 'sent', data };
  }

  @Delete()
  @UsePipes(new ValidationPipe({ transform: true }))
  async delete(@Query() q: DeleteAutoMessageDto, @Id() adminId: string) {
    const data = await this.svc.delete(adminId, q.webinarId, q.projectId);
    return { statusCode: 200, message: 'deleted', data };
  }
}


