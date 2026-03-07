import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpCode,
  HttpStatus,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CampaignService } from './campaign.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { ExecuteCampaignDto } from './dto/execute-campaign.dto';
import { CreateCampaignWorkflowDto } from './dto/create-campaign-workflow.dto';
import { Id } from '../../decorators/custom.decorator';

@Controller('campaign')
export class CampaignController {
  constructor(private readonly campaignService: CampaignService) {}

  @Post()
  create(@Body() createCampaignDto: CreateCampaignDto, @Id() adminId: string) {
    return this.campaignService.create(createCampaignDto, adminId);
  }

  @Post('workflow')
  @UsePipes(new ValidationPipe({ transform: true }))
  createCampaignWorkflow(
    @Body() createCampaignWorkflowDto: CreateCampaignWorkflowDto,
    @Id() adminId: string,
  ) {
    return this.campaignService.createCampaignWorkflow(
      createCampaignWorkflowDto,
      adminId,
    );
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

    return this.campaignService.findAll(adminId, projectId, pageNum, limitNum);
  }

  @Get('scheduled')
  getScheduledCampaigns() {
    return this.campaignService.getScheduledCampaigns();
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Id() adminId: string) {
    return this.campaignService.findOne(id, adminId);
  }

  @Get(':id/analytics')
  getCampaignAnalytics(@Param('id') id: string, @Id() adminId: string) {
    return this.campaignService.getCampaignAnalytics(id, adminId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateCampaignDto: UpdateCampaignDto,
    @Id() adminId: string,
  ) {
    return this.campaignService.update(id, updateCampaignDto, adminId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Id() adminId: string) {
    return this.campaignService.remove(id, adminId);
  }

  @Post('execute')
  @UsePipes(new ValidationPipe({ transform: true }))
  async executeCampaign(
    @Body() executeCampaignDto: ExecuteCampaignDto,
    @Id() adminId: string,
  ) {
    const result = await this.campaignService.executeCampaign(
      executeCampaignDto,
      adminId,
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Campaign executed successfully!',
      data: result,
    };
  }

  @Get(':id/results')
  async getCampaignResults(@Param('id') id: string, @Id() adminId: string) {
    const result = await this.campaignService.getCampaignExecutionResults(
      id,
      adminId,
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Campaign results fetched successfully',
      data: result,
    };
  }

  @Get(':id/report/download')
  async downloadCampaignReport(@Param('id') id: string, @Id() adminId: string) {
    const result = await this.campaignService.getCampaignReportForDownload(
      id,
      adminId,
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Campaign report data fetched successfully',
      data: result,
    };
  }

  @Patch(':id/cancel')
  async cancelScheduledCampaign(@Param('id') id: string, @Id() adminId: string) {
    const campaign = await this.campaignService.cancelScheduledCampaign(id, adminId);
    return {
      statusCode: HttpStatus.OK,
      message: 'Scheduled campaign cancelled successfully',
      data: campaign,
    };
  }

  @Patch(':id/reschedule')
  @UsePipes(new ValidationPipe({ transform: true }))
  async rescheduleCampaign(
    @Param('id') id: string,
    @Body() body: { scheduledAt: string },
    @Id() adminId: string,
  ) {
    const campaign = await this.campaignService.rescheduleCampaign(id, body.scheduledAt, adminId);
    return {
      statusCode: HttpStatus.OK,
      message: 'Campaign rescheduled successfully',
      data: campaign,
    };
  }
}
