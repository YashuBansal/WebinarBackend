import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  ValidationPipe,
} from '@nestjs/common';
import {
  CreateProjectDto,
  PaginationQueryDto,
  UpdateProjectDto,
} from './dto/projects.dto';
import { Project } from 'src/schemas/project.schema';
import { Id } from 'src/decorators/custom.decorator';
import { Types } from 'mongoose';
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
    paginationQuery: PaginationQueryDto,
    @Id() adminId: string,
  ) {
    const { page, limit } = paginationQuery;
    return this.projectsService.fetchWabaMessages(new Types.ObjectId(projectId), new Types.ObjectId(`${adminId}`), { page, limit });
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

  @Post('waba-details')
  async getWabaDetails(
    @Body() fetchWabaDetailsDto: FetchWabaDetailsDto,
  ): Promise<any> {
    return this.projectsService.getWabaDetailsTest(fetchWabaDetailsDto);
  }
}
