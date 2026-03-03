import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UsePipes,
  ValidationPipe,
  BadRequestException,
  HttpStatus,
} from '@nestjs/common';
import { Id } from 'src/decorators/custom.decorator';
import mongoose, { Types } from 'mongoose';
import { ChatbotTriggerService } from './chatbot-trigger.service';
import { CreateChatbotTriggerDto } from './dto/create-chatbot-trigger.dto';
import { UpdateChatbotTriggerDto } from './dto/update-chatbot-trigger.dto';

@Controller('whatsapp/chatbot')
export class ChatbotTriggerController {
  constructor(private readonly chatbotTriggerService: ChatbotTriggerService) {}

  @Get('triggers')
  @UsePipes(new ValidationPipe({ transform: true }))
  async list(@Query('projectId') projectId: string, @Id() adminId: string) {
    if (!mongoose.isValidObjectId(projectId) || !mongoose.isValidObjectId(adminId)) {
      throw new BadRequestException('Invalid projectId or adminId');
    }
    const data = await this.chatbotTriggerService.findAllByProject(
      new Types.ObjectId(adminId),
      new Types.ObjectId(projectId),
    );
    return { statusCode: HttpStatus.OK, message: 'ok', data };
  }

  @Post('triggers')
  @UsePipes(new ValidationPipe({ transform: true }))
  async create(@Body() dto: CreateChatbotTriggerDto, @Id() adminId: string) {
    if (!mongoose.isValidObjectId(adminId) || !mongoose.isValidObjectId(dto.projectId)) {
      throw new BadRequestException('Invalid adminId or projectId');
    }
    const data = await this.chatbotTriggerService.create(
      new Types.ObjectId(adminId),
      new Types.ObjectId(dto.projectId),
      dto,
    );
    return { statusCode: HttpStatus.CREATED, message: 'created', data };
  }

  @Patch('triggers/:id')
  @UsePipes(new ValidationPipe({ transform: true }))
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateChatbotTriggerDto,
    @Id() adminId: string,
    @Query('projectId') projectId: string,
  ) {
    if (!mongoose.isValidObjectId(adminId) || !mongoose.isValidObjectId(projectId)) {
      throw new BadRequestException('Invalid adminId or projectId');
    }
    const data = await this.chatbotTriggerService.update(
      new Types.ObjectId(adminId),
      new Types.ObjectId(projectId),
      id,
      dto,
    );
    return { statusCode: HttpStatus.OK, message: 'updated', data };
  }

  @Delete('triggers/:id')
  async delete(
    @Param('id') id: string,
    @Id() adminId: string,
    @Query('projectId') projectId: string,
  ) {
    if (!mongoose.isValidObjectId(adminId) || !mongoose.isValidObjectId(projectId)) {
      throw new BadRequestException('Invalid adminId or projectId');
    }
    await this.chatbotTriggerService.delete(
      new Types.ObjectId(adminId),
      new Types.ObjectId(projectId),
      id,
    );
    return { statusCode: HttpStatus.OK, message: 'deleted' };
  }
}
