import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  NotAcceptableException,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import mongoose, { Types } from 'mongoose';
import { WabaTemplateService } from './waba-template.service';
import {
  CreateTemplateDto,
  DeleteTemplateDto,
  GetTemplatesQueryDto,
} from 'src/whatsapp/dto/template.dto';
import { Id } from 'src/decorators/custom.decorator';

@Controller('waba-template')
export class WabaTemplateController {
  constructor(private readonly wabaTemplateService: WabaTemplateService) {}

  @Get('sync/:projectId')
  async syncWabaTemplates(
    @Param('projectId') projectId: string,
    @Id() adminId: string,
  ) {
    if (!mongoose.isValidObjectId(projectId)) {
      throw new BadRequestException('Invalid project ID');
    }

    if (!mongoose.isValidObjectId(adminId)) {
      throw new UnauthorizedException('Invalid admin ID');
    }

    return this.wabaTemplateService.syncWabaTemplates(
      new Types.ObjectId(`${adminId}`),
      new Types.ObjectId(`${projectId}`),
    );
  }

  @Get(':projectId')
  async getTemplates(
    @Param('projectId') projectId: string,
    @Id() adminId: string,
    @Query() query: GetTemplatesQueryDto,
  ) {
    if (!mongoose.isValidObjectId(projectId)) {
      throw new NotAcceptableException('Invalid Project ID');
    }

    if (!mongoose.isValidObjectId(adminId)) {
      throw new UnauthorizedException('Invalid admin ID');
    }

    const templates = await this.wabaTemplateService.getTemplatesFromDb(
      new Types.ObjectId(`${adminId}`),
      new Types.ObjectId(`${projectId}`),
      query,
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Templates fetched successfully',
      data: templates,
    };
  }

  @Post(':projectId')
  async createTemplate(
    @Param('projectId') projectId: string,
    @Body() createTemplateDto: CreateTemplateDto,
    @Id() adminId: string,
  ) {
    if (!mongoose.isValidObjectId(projectId)) {
      throw new NotAcceptableException('Invalid Project ID');
    }

    await this.wabaTemplateService.createTemplate(
      new Types.ObjectId(`${adminId}`),
      new Types.ObjectId(`${projectId}`),
      createTemplateDto,
    );
    return {
      statusCode: HttpStatus.CREATED,
      message: 'Template submitted for review successfully!',
    };
  }

  @Delete(':projectId')
  async deleteTemplate(
    @Param('projectId') projectId: string,
    @Query() deleteTemplateDto: DeleteTemplateDto,
    @Id() adminId: string,
  ) {
    if (!mongoose.isValidObjectId(projectId)) {
      throw new NotAcceptableException('Invalid Project ID');
    }

    const result = await this.wabaTemplateService.deleteTemplate(
      new Types.ObjectId(`${adminId}`),
      new Types.ObjectId(`${projectId}`),
      deleteTemplateDto,
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Template deleted successfully!',
      data: result,
    };
  }
}
