import {
  BadRequestException,
  Controller,
  Get,
  HttpStatus,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import mongoose from 'mongoose';
import { WhatsappOptoutService } from './whatsapp-optout.service';
import { Id } from 'src/decorators/custom.decorator';

@Controller('whatsapp-optout')
export class WhatsappOptoutController {
  constructor(private readonly whatsappOptoutService: WhatsappOptoutService) {}

  @Get()
  async listOptedOutNumbers(
    @Id() _adminId: string,
    @Query('projectId') projectId: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    if (!mongoose.isValidObjectId(projectId)) {
      throw new BadRequestException('Invalid project ID');
    }

    const pageNum = Number(page);
    const limitNum = Number(limit);
    const safePage = Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1;
    const safeLimit =
      Number.isFinite(limitNum) && limitNum > 0 && limitNum <= 100
        ? limitNum
        : 20;

    const { items, total } = await this.whatsappOptoutService.listByProject(
      projectId,
      safePage,
      safeLimit,
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Opted out numbers fetched successfully',
      data: {
        items,
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  @Patch(':optoutId/opt-in')
  async optInNumber(
    @Id() _adminId: string,
    @Param('optoutId') optoutId: string,
    @Query('projectId') projectId: string,
  ) {
    if (!mongoose.isValidObjectId(projectId)) {
      throw new BadRequestException('Invalid project ID');
    }
    if (!mongoose.isValidObjectId(optoutId)) {
      throw new BadRequestException('Invalid opt-out ID');
    }

    const removed = await this.whatsappOptoutService.optIn(projectId, optoutId);
    return {
      statusCode: HttpStatus.OK,
      message: removed ? 'Number opted in successfully' : 'Number not found',
      data: { removed },
    };
  }
}
