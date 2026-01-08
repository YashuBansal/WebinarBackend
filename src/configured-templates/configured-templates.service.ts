import {
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfiguredTemplate, ConfiguredTemplateDocument } from 'src/configured-templates/schema/configured-template.schema';
import {
  CreateConfiguredTemplateDto,
  UpdateConfiguredTemplateDto,
} from './dto/configured-template.dto';
import { WhatsappService } from 'src/whatsapp/whatsapp.service';

@Injectable()
export class ConfiguredTemplatesService {
  private readonly logger = new Logger(ConfiguredTemplatesService.name);

  constructor(
    @InjectModel(ConfiguredTemplate.name)
    private readonly configuredTemplateModel: Model<ConfiguredTemplateDocument>,
    private readonly whatsappService: WhatsappService,
  ) { }

  async getConfiguredTemplates(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    page: number,
    limit: number,
    search?: string,
    isActive?: boolean,
  ) {
    try {
      this.logger.log(
        `Fetching configured templates for admin ${adminId}, project ${projectId}, page ${page}, limit ${limit}`,
      );

      const query: any = {
        adminId,
        project: projectId,
        isDeleted: false,
      };

      // Add search filter
      if (search) {
        query.$or = [
          { templateName: { $regex: search, $options: 'i' } },
          { configuredTemplateName: { $regex: search, $options: 'i' } },
        ];
      }

      // Add active filter
      if (isActive !== undefined) {
        query.isActive = isActive;
      }

      const skip = (page - 1) * limit;

      const [configuredTemplates, total] = await Promise.all([
        this.configuredTemplateModel
          .find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .exec(),
        this.configuredTemplateModel.countDocuments(query).exec(),
      ]);

      return {
        data: configuredTemplates,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(`Failed to fetch configured templates: ${error.message}`, error.stack);
      throw new InternalServerErrorException('A server error occurred while fetching configured templates.');
    }
  }

  async createConfiguredTemplate(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    createConfiguredTemplateDto: CreateConfiguredTemplateDto,
  ) {
    try {
      this.logger.log(
        `Creating configured template for admin ${adminId}, project ${projectId}`,
      );

      // Check if a configured template with the same name already exists
      const existingTemplate = await this.configuredTemplateModel.findOne({
        adminId,
        project: projectId,
        configuredTemplateName: createConfiguredTemplateDto.configuredTemplateName,
        isDeleted: false,
      }).exec();

      if (existingTemplate) {
        throw new BadRequestException(
          'A configured template with this name already exists for this project',
        );
      }

      await this.whatsappService.checkVariableMappingLength({
        adminId: adminId.toString(),
        projectId: projectId.toString(),
        templateName: createConfiguredTemplateDto.templateName,
        givenVariableLength: createConfiguredTemplateDto?.variableMappings?.length ?? 0,
        headerMediaAssetId: createConfiguredTemplateDto?.headerMediaAssetId?.toString() ?? null,
      })

      const configuredTemplate = new this.configuredTemplateModel({
        ...createConfiguredTemplateDto,
        adminId,
        project: projectId,
        isActive: createConfiguredTemplateDto.isActive ?? true,
      });

      const savedTemplate = await configuredTemplate.save();
      this.logger.log(`Configured template created successfully: ${savedTemplate._id}`);

      return savedTemplate;
    } catch (error) {
      this.logger.error(`Failed to create configured template: ${error.message}`, error.stack);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('A server error occurred while creating the configured template.');
    }
  }

  async updateConfiguredTemplate(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    configuredTemplateId: Types.ObjectId,
    updateConfiguredTemplateDto: UpdateConfiguredTemplateDto,
  ) {
    try {
      this.logger.log(
        `Updating configured template ${configuredTemplateId} for admin ${adminId}, project ${projectId}`,
      );

      // Check if template exists
      const existingTemplate = await this.configuredTemplateModel.findOne({
        _id: configuredTemplateId,
        adminId,
        project: projectId,
        isDeleted: false,
      }).exec();

      if (!existingTemplate) {
        throw new NotFoundException('Configured template not found');
      }

      // Check if another template with the same name exists (if name is being updated)
      if (updateConfiguredTemplateDto.configuredTemplateName) {
        const duplicateTemplate = await this.configuredTemplateModel.findOne({
          _id: { $ne: configuredTemplateId },
          adminId,
          project: projectId,
          configuredTemplateName: updateConfiguredTemplateDto.configuredTemplateName,
          isDeleted: false,
        }).exec();

        if (duplicateTemplate) {
          throw new BadRequestException(
            'A configured template with this name already exists for this project',
          );
        }
      }

      const updatedTemplate = await this.configuredTemplateModel
        .findOneAndUpdate(
          {
            _id: configuredTemplateId,
            adminId,
            project: projectId,
            isDeleted: false,
          },
          updateConfiguredTemplateDto,
          { new: true }
        )
        .exec();

      if (!updatedTemplate) {
        throw new NotFoundException('Configured template not found');
      }

      this.logger.log(`Configured template updated successfully: ${configuredTemplateId}`);
      return updatedTemplate;
    } catch (error) {
      this.logger.error(`Failed to update configured template: ${error.message}`, error.stack);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('A server error occurred while updating the configured template.');
    }
  }

  async deleteConfiguredTemplate(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    configuredTemplateId: Types.ObjectId,
  ) {
    try {
      this.logger.log(
        `Deleting configured template ${configuredTemplateId} for admin ${adminId}, project ${projectId}`,
      );

      const deletedTemplate = await this.configuredTemplateModel
        .findOneAndUpdate(
          {
            _id: configuredTemplateId,
            adminId,
            project: projectId,
            isDeleted: false,
          },
          { isDeleted: true },
          { new: true }
        )
        .exec();

      if (!deletedTemplate) {
        throw new NotFoundException('Configured template not found');
      }

      this.logger.log(`Configured template deleted successfully: ${configuredTemplateId}`);
      return deletedTemplate;
    } catch (error) {
      this.logger.error(`Failed to delete configured template: ${error.message}`, error.stack);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('A server error occurred while deleting the configured template.');
    }
  }

  async getConfiguredTemplateById(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    configuredTemplateId: Types.ObjectId,
  ) {
    try {
      this.logger.log(
        `Fetching configured template ${configuredTemplateId} for admin ${adminId}, project ${projectId}`,
      );

      const configuredTemplate = await this.configuredTemplateModel
        .findOne({
          _id: configuredTemplateId,
          adminId,
          project: projectId,
          isDeleted: false,
        })
        .exec();

      if (!configuredTemplate) {
        throw new NotFoundException('Configured template not found');
      }

      return configuredTemplate;
    } catch (error) {
      this.logger.error(`Failed to fetch configured template: ${error.message}`, error.stack);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('A server error occurred while fetching the configured template.');
    }
  }

  async getConfiguredTemplate(configuredTemplateId: Types.ObjectId): Promise<ConfiguredTemplate | null> {
    try {
      this.logger.log(`Fetching configured template ${configuredTemplateId}`);
      const configuredTemplate = await this.configuredTemplateModel.findOne({ _id: configuredTemplateId, isDeleted: false }).exec();
      return configuredTemplate;
    } catch (error) {
      this.logger.error(`Failed to fetch configured template: ${error.message}`, error.stack);
      throw new InternalServerErrorException('A server error occurred while fetching the configured template.');
    }
  }
}
