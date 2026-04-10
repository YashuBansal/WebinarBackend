import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  ValidationPipe,
  Delete,
} from '@nestjs/common';
import {
  CampaignPaginationQueryDto,
  CreateProjectDto,
  PaginationQueryDto,
  UpdateProjectDto,
} from './dto/projects.dto';
import { Project } from 'src/schemas/project.schema';
import { Id } from 'src/decorators/custom.decorator';
import mongoose, { Types } from 'mongoose';
import { ProjectsService } from './projects.service';
import { FetchWabaDetailsDto } from './dto/waba.dto';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  async create(
    @Body() createProjectDto: CreateProjectDto,
    @Id() adminId: string,
  ): Promise<Project> {
    return this.projectsService.create(
      createProjectDto,
      new Types.ObjectId(`${adminId}`),
    );
  }

  @Get()
  async fetchProjects(
    @Id() adminId: string, // Assumes your custom @Id() decorator works
    @Query(
      new ValidationPipe({
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    )
    paginationQuery: PaginationQueryDto,
  ) {
    const { page, limit } = paginationQuery;

    return this.projectsService.findByUserId(new Types.ObjectId(adminId), {
      page,
      limit,
    });
  }

  @Get('waba-messages/:projectId')
  async fetchWabaMessages(
    @Param('projectId') projectId: string,
    @Query(
      new ValidationPipe({
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    )
    paginationQuery: CampaignPaginationQueryDto,
    @Id() adminId: string,
  ) {
    const {
      page,
      limit,
      campaignId,
      apiCampaignId,
      datePreset,
      startDate,
      endDate,
      messageType,
      meetingId,
    } = paginationQuery;
    let dateFilter: { start?: Date; end?: Date } | undefined = {};
    if (datePreset === 'today') {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      dateFilter = { start, end };
    } else if (datePreset === 'yesterday') {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      const start = new Date(d);
      start.setHours(0, 0, 0, 0);
      const end = new Date(d);
      end.setHours(23, 59, 59, 999);
      dateFilter = { start, end };
    } else if (datePreset === 'lastWeek') {
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      const start = new Date();
      start.setDate(start.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      dateFilter = { start, end };
    } else if (datePreset === 'custom' && (startDate || endDate)) {
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        dateFilter.start = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.end = end;
      }
    }

    return this.projectsService.fetchWabaMessages(
      {
        adminId: new Types.ObjectId(`${adminId}`),
        projectId: new Types.ObjectId(projectId),
        ...(messageType && { messageType }),
        ...(mongoose.isValidObjectId(campaignId) && {
          campaignId: new Types.ObjectId(campaignId),
        }),
        ...(mongoose.isValidObjectId(apiCampaignId) && {
          apiCampaignId: new Types.ObjectId(apiCampaignId),
        }),
        ...(meetingId && { meetingId }),
      },
      { page, limit },
      dateFilter,
    );
  }

  @Get('whatsapp')
  async fetchWhatsAppProjects(@Id() adminId: string) {
    return this.projectsService.findWhatsAppProjectsByUserId(
      new Types.ObjectId(adminId),
    );
  }

  @Get(':id')
  async fetchProjectsById(
    @Id() adminId: string, // Assumes your custom @Id() decorator works
    @Param('id') projectId: string,
    @Query(
      new ValidationPipe({
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    )
    paginationQuery: PaginationQueryDto,
  ) {
    const { page, limit } = paginationQuery;

    return this.projectsService.findOne(
      new Types.ObjectId(adminId),
      new Types.ObjectId(projectId),
    );
  }

  @Patch(':id')
  async updateProject(
    @Id() adminId: string, // Assumes your custom @Id() decorator works
    @Param('id') projectId: string,
    @Body() updateProjectDto: UpdateProjectDto,
  ) {
    return this.projectsService.update(
      new Types.ObjectId(adminId),
      new Types.ObjectId(projectId),
      updateProjectDto,
    );
  }

  @Delete(':id')
  async softDeleteProject(
    @Id() adminId: string,
    @Param('id') projectId: string,
  ) {
    // Use the service remove method, which performs a soft delete
    return this.projectsService.remove(projectId);
  }

  @Post('waba-details')
  async getWabaDetails(
    @Body() fetchWabaDetailsDto: FetchWabaDetailsDto,
  ): Promise<any> {
    return this.projectsService.getWabaDetailsTest(fetchWabaDetailsDto);
  }
}
