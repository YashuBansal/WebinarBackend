import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  NotFoundException,
} from '@nestjs/common';
import { NoticeBoardService } from './notice-board.service';
import { NoticeBoard } from '../schemas/notice-board.schema';
import { AdminId, Id } from 'src/decorators/custom.decorator';
import { Types } from 'mongoose';

@Controller('notice-board')
export class NoticeBoardController {
  constructor(private readonly noticeBoardService: NoticeBoardService) {}

  @Get()
  async getNoticeBoard(
    @AdminId() adminId: Types.ObjectId,
  ): Promise<NoticeBoard> {
    if (!adminId) {
      throw new NotFoundException('Admin ID is required');
    }
    return await this.noticeBoardService.find(adminId);
  }

  @Post()
  async createOrUpdateNoticeBoard(
    @Body('content') content: string,
    @Body('type') type: string,
    @Id() adminId: string,
  ): Promise<NoticeBoard> {
    if (!adminId) {
      throw new NotFoundException('Admin ID is required');
    }
    return await this.noticeBoardService.createOrUpdate(
      new Types.ObjectId(`${adminId}`),
      content,
      type,
    );
  }
}
