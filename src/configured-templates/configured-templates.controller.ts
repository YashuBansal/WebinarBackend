import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  Param,
  Delete,
  Patch,
  ValidationPipe,
  UsePipes,
  BadRequestException,
  NotAcceptableException,
} from '@nestjs/common';
import { ConfiguredTemplatesService } from './configured-templates.service';
import { Id } from 'src/decorators/custom.decorator';
import mongoose, { Types } from 'mongoose';
import {
  CreateConfiguredTemplateDto,
  UpdateConfiguredTemplateDto,
  GetConfiguredTemplatesQueryDto,
} from './dto/configured-template.dto';

@Controller('configured-templates')
export class ConfiguredTemplatesController {
  constructor(private readonly configuredTemplatesService: ConfiguredTemplatesService) {}

  @Get(':projectId')
  @UsePipes(new ValidationPipe({ transform: true }))
  async getConfiguredTemplates(
    @Param('projectId') projectId: string,
    @Id() adminId: string,
    @Query() query: GetConfiguredTemplatesQueryDto,
  ) {
    if (!mongoose.isValidObjectId(projectId)) {
      throw new NotAcceptableException('Invalid Project ID');
    }

    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '20', 10);

    const configuredTemplates = await this.configuredTemplatesService.getConfiguredTemplates(
      new Types.ObjectId(`${adminId}`),
      new Types.ObjectId(`${projectId}`),
      page,
      limit,
      query.search,
      query.isActive,
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Configured templates fetched successfully',
      data: configuredTemplates,
    };
  }

  @Post(':projectId')
  @UsePipes(new ValidationPipe({ transform: true }))
  async createConfiguredTemplate(
    @Param('projectId') projectId: string,
    @Body() createConfiguredTemplateDto: CreateConfiguredTemplateDto,
    @Id() adminId: string,
  ) {
    if (!mongoose.isValidObjectId(projectId)) {
      throw new NotAcceptableException('Invalid Project ID');
    }

    const result = await this.configuredTemplatesService.createConfiguredTemplate(
      new Types.ObjectId(`${adminId}`),
      new Types.ObjectId(`${projectId}`),
      createConfiguredTemplateDto,
    );

    return {
      statusCode: HttpStatus.CREATED,
      message: 'Configured template created successfully!',
      data: result,
    };
  }

  @Patch(':projectId/:configuredTemplateId')
  @UsePipes(new ValidationPipe({ transform: true }))
  async updateConfiguredTemplate(
    @Param('projectId') projectId: string,
    @Param('configuredTemplateId') configuredTemplateId: string,
    @Body() updateConfiguredTemplateDto: UpdateConfiguredTemplateDto,
    @Id() adminId: string,
  ) {
    if (!mongoose.isValidObjectId(projectId)) {
      throw new NotAcceptableException('Invalid Project ID');
    }

    if (!mongoose.isValidObjectId(configuredTemplateId)) {
      throw new NotAcceptableException('Invalid Configured Template ID');
    }

    const result = await this.configuredTemplatesService.updateConfiguredTemplate(
      new Types.ObjectId(`${adminId}`),
      new Types.ObjectId(`${projectId}`),
      new Types.ObjectId(`${configuredTemplateId}`),
      updateConfiguredTemplateDto,
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Configured template updated successfully!',
      data: result,
    };
  }

  @Delete(':projectId/:configuredTemplateId')
  async deleteConfiguredTemplate(
    @Param('projectId') projectId: string,
    @Param('configuredTemplateId') configuredTemplateId: string,
    @Id() adminId: string,
  ) {
    if (!mongoose.isValidObjectId(projectId)) {
      throw new NotAcceptableException('Invalid Project ID');
    }

    if (!mongoose.isValidObjectId(configuredTemplateId)) {
      throw new NotAcceptableException('Invalid Configured Template ID');
    }

    const result = await this.configuredTemplatesService.deleteConfiguredTemplate(
      new Types.ObjectId(`${adminId}`),
      new Types.ObjectId(`${projectId}`),
      new Types.ObjectId(`${configuredTemplateId}`),
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Configured template deleted successfully!',
      data: result,
    };
  }

  @Get(':projectId/:configuredTemplateId')
  async getConfiguredTemplateById(
    @Param('projectId') projectId: string,
    @Param('configuredTemplateId') configuredTemplateId: string,
    @Id() adminId: string,
  ) {
    if (!mongoose.isValidObjectId(projectId)) {
      throw new NotAcceptableException('Invalid Project ID');
    }

    if (!mongoose.isValidObjectId(configuredTemplateId)) {
      throw new NotAcceptableException('Invalid Configured Template ID');
    }

    const configuredTemplate = await this.configuredTemplatesService.getConfiguredTemplateById(
      new Types.ObjectId(`${adminId}`),
      new Types.ObjectId(`${projectId}`),
      new Types.ObjectId(`${configuredTemplateId}`),
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Configured template fetched successfully',
      data: configuredTemplate,
    };
  }
}
