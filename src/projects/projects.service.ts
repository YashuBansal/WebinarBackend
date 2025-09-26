import {
  Injectable,
  Logger,
  NotAcceptableException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Project, ProjectDocument } from 'src/schemas/project.schema';
import { CreateProjectDto, UpdateProjectDto } from './dto/projects.dto';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { FetchWabaDetailsDto } from './dto/waba.dto';
import { WabaMessageService } from 'src/whatsapp-embed/waba-message/waba-message.service';
import { WabaMessage } from 'src/schemas/whatsapp-embed/waba-message.schema';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);
  constructor(
    @InjectModel(Project.name)
    private readonly projectModel: Model<ProjectDocument>,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly wabaMessageService: WabaMessageService,
  ) { }


  async fetchWabaMessages(data: { projectId: Types.ObjectId; adminId: Types.ObjectId; campaignId?: Types.ObjectId }, paginationOptions: { page: number; limit: number }) {
    return this.wabaMessageService.findPaginatedAll(data, paginationOptions);

  }

  async create(
    createProjectDto: CreateProjectDto,
    adminId: Types.ObjectId,
  ): Promise<Project> {
    const { projectName } = createProjectDto;

    const project = await this.projectModel.findOne({
      adminId,
      projectName,
    });

    if (project) {
      throw new NotAcceptableException('Project Already Found');
    }

    const newProject = await this.projectModel.create({
      projectName,
      adminId,
    });
    return newProject;
  }

  async findByUserId(
    adminId: Types.ObjectId,
    paginationOptions: { page: number; limit: number },
  ) {
    const { page, limit } = paginationOptions;
    const skip = (page - 1) * limit;

    const filter = { adminId };

    // Execute count and find queries in parallel for efficiency
    const [totalResults, results] = await Promise.all([
      this.projectModel.countDocuments(filter).exec(),
      this.projectModel.find(filter).skip(skip).limit(limit).exec(),
    ]);

    const totalPages = Math.ceil(totalResults / limit);

    return {
      results,
      page,
      limit,
      totalPages: totalPages || 1,
      totalResults,
    };
  }

  async findAll(): Promise<Project[]> {
    return this.projectModel.find().populate('adminId', 'name').exec();
  }

  async findOne(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
  ): Promise<ProjectDocument> {
    const project = await this.projectModel
      .findOne({ _id: projectId, adminId })
      .exec();

    if (!project) {
      throw new NotFoundException(`Project with ID "${projectId}" not found.`);
    }

    return project;
  }

  async findOneByAdminId(adminId: Types.ObjectId): Promise<Project> {
    const project = await this.projectModel.findOne({ adminId }).exec();

    if (!project) {
      throw new NotFoundException(`Project with ID "${adminId}" not found.`);
    }

    return project;
  }

  async update(
    id: Types.ObjectId,
    projectId: Types.ObjectId,
    updateProjectDto: UpdateProjectDto,
  ): Promise<Project> {
    const updatedProject = await this.projectModel
      .findByIdAndUpdate(
        projectId,
        {
          $set: {
            ...updateProjectDto,
          },
        },
        { new: true },
      )
      .exec();

    if (!updatedProject) {
      throw new NotFoundException(`Project with ID "${projectId}" not found.`);
    }

    return updatedProject;
  }

  async remove(id: string): Promise<Project> {
    const deletedProject = await this.projectModel.findByIdAndDelete(id).exec();

    if (!deletedProject) {
      throw new NotFoundException(`Project with ID "${id}" not found.`);
    }

    return deletedProject;
  }

  async getWabaDetailsTest(data: FetchWabaDetailsDto): Promise<any> {
    const { wabaId, accessToken } = data;
    const fields =
      'name,message_template_namespace,phone_numbers{id,display_phone_number,quality_rating}';

    // --- THE FIX ---
    // Let's be explicit with the API version to ensure it's correct.
    const apiVersion = this.configService.get('GRAPH_API_VERSION') || 'v23.0';

    // The URL structure for a specific object IS correct.
    // The error usually means the object ID is not considered valid at that path,
    // which can happen if the token doesn't have permission OR the API version is malformed.
    const url = `https://graph.facebook.com/${apiVersion}/${wabaId}`;

    const params = {
      fields: fields,
      access_token: accessToken,
    };

    this.logger.log(`Fetching WABA details from URL: ${url}`);

    try {
      const response = await firstValueFrom(
        this.httpService.get(url, { params }),
      );
      return response.data;
    } catch (error) {
      this.logger.error(
        `Failed to get WABA details for ID`,
        error.response?.data,
      );
      // Re-throw the original error to be handled by the calling function
      throw error;
    }
  }
}
