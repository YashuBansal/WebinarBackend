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
  HttpStatus,
} from '@nestjs/common';
import { ApiCampaignService } from './api-campaign.service';
import { CreateApiCampaignDto } from './dto/create-api-campaign.dto';
import { UpdateApiCampaignDto } from './dto/update-api-campaign.dto';
import { ExecuteApiCampaignDto } from './dto/execute-api-campaign.dto';
import { Id } from '../../decorators/custom.decorator';

@Controller('api-campaign')
export class ApiCampaignController {
  constructor(private readonly apiCampaignService: ApiCampaignService) {}

  @Post()
  @UsePipes(new ValidationPipe({ transform: true }))
  create(
    @Body() createApiCampaignDto: CreateApiCampaignDto,
    @Id() adminId: string,
  ) {
    return this.apiCampaignService.create(createApiCampaignDto, adminId);
  }

  @Get()
  findAll(
    @Id() adminId: string,
    @Query('projectId') projectId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 10;

    return this.apiCampaignService.findAll(adminId, projectId, pageNum, limitNum);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Id() adminId: string) {
    return this.apiCampaignService.findOne(id, adminId);
  }

  @Get(':id/report/download')
  async downloadReport(@Param('id') id: string, @Id() adminId: string) {
    const result = await this.apiCampaignService.getApiCampaignReportForDownload(
      id,
      adminId,
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'API campaign report data fetched successfully',
      data: result,
    };
  }

  @Patch(':id')
  @UsePipes(new ValidationPipe({ transform: true }))
  update(
    @Param('id') id: string,
    @Body() updateApiCampaignDto: UpdateApiCampaignDto,
    @Id() adminId: string,
  ) {
    return this.apiCampaignService.update(id, updateApiCampaignDto, adminId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Id() adminId: string) {
    return this.apiCampaignService.remove(id, adminId);
  }

  @Post('execute')
  @UsePipes(new ValidationPipe({ transform: true }))
  execute(
    @Body() executeApiCampaignDto: ExecuteApiCampaignDto,
    @Id() adminId: string,
  ) {
    return this.apiCampaignService.execute(executeApiCampaignDto, adminId);
  }
}

