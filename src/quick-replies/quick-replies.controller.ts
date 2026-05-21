import { Controller, Get, Post, Body, Param, Delete, HttpStatus, BadRequestException } from '@nestjs/common';
import { QuickRepliesService } from './quick-replies.service';
import { Id } from '../decorators/custom.decorator';
import { Types } from 'mongoose';

@Controller('quick-replies')
export class QuickRepliesController {
  constructor(private readonly quickRepliesService: QuickRepliesService) {}

  @Post()
  async create(@Id() adminId: string, @Body() payload: any) {
    if (!adminId || !Types.ObjectId.isValid(String(adminId))) {
      throw new BadRequestException('Invalid admin ID');
    }
    if (!payload.projectId || !Types.ObjectId.isValid(String(payload.projectId))) {
      throw new BadRequestException('Invalid project ID');
    }

    try {
      const data = await this.quickRepliesService.create(new Types.ObjectId(String(adminId)), payload);
      return {
        statusCode: HttpStatus.CREATED,
        message: 'Quick reply created successfully',
        data,
      };
    } catch (error) {
      if (error.code === 11000) {
        throw new BadRequestException('A session template with this name already exists in this project');
      }
      console.error('Error creating quick reply:', error);
      throw new BadRequestException(`Failed to create quick reply: ${error.message}`);
    }
  }

  @Get(':projectId')
  async list(@Param('projectId') projectId: string) {
    if (!projectId || !Types.ObjectId.isValid(projectId)) {
      throw new BadRequestException('Invalid project ID');
    }
    const data = await this.quickRepliesService.list(projectId);
    return {
      statusCode: HttpStatus.OK,
      message: 'Quick replies fetched successfully',
      data,
    };
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    await this.quickRepliesService.delete(id);
    return {
      statusCode: HttpStatus.OK,
      message: 'Quick reply deleted successfully',
    };
  }
}
