import {
  Injectable,
  NotFoundException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  WebinarAutoMessage,
  WebinarAutoMessageDocument,
} from './webinar-auto-message.schema';
import { UpsertAutoMessageDto, TestSendDto, VariableMappingDto } from './dto';
import { WhatsappService } from 'src/whatsapp/whatsapp.service';
import { ProjectsService } from 'src/projects/projects.service';
import { WabaMessageType } from 'src/whatsapp-embed/waba-message/waba-message.schema';

@Injectable()
export class WebinarAutoMessageService {
  private readonly logger = new Logger(WebinarAutoMessageService.name);

  constructor(
    @InjectModel(WebinarAutoMessage.name)
    private model: Model<WebinarAutoMessageDocument>,
    private readonly whatsappService: WhatsappService,
    private readonly projectsService: ProjectsService,
  ) {}

  async getConfig(adminId: string, webinarId: string) {
    return this.model
      .findOne({
        adminId: new Types.ObjectId(adminId),
        webinarId: new Types.ObjectId(webinarId),
      })
      .lean();
  }

  async upsert(adminId: string, dto: UpsertAutoMessageDto) {
    await this.whatsappService.checkVariableMappingLength({
      adminId,
      projectId: dto.projectId,
      templateName: dto.templateName,
      givenVariableLength: dto.variableMappings?.length || 0,
      headerMediaAssetId: dto.headerMediaAssetId,
    });

    const filter = {
      adminId: new Types.ObjectId(adminId),
      projectId: new Types.ObjectId(dto.projectId),
      webinarId: new Types.ObjectId(dto.webinarId),
    };
    const update = {
      ...filter,
      templateName: dto.templateName,
      language: dto.language || 'en_US',
      headerMediaAssetId: dto.headerMediaAssetId,
      enabled: dto.enabled,
      variableMappings: dto.variableMappings || [],
    };
    const doc = await this.model.findOneAndUpdate(filter, update, {
      upsert: true,
      new: true,
    });
    return doc;
  }

  async list(adminId: string, projectId?: string) {
    this.logger.log(
      `Listing webinar auto messages for adminId: ${adminId}, projectId: ${projectId || 'all'}`,
    );

    try {
      // Validate adminId
      if (!adminId || !Types.ObjectId.isValid(adminId)) {
        this.logger.error(`Invalid adminId provided: ${adminId}`);
        throw new BadRequestException('Invalid adminId provided');
      }

      // Build filter
      const filter: any = {
        adminId: new Types.ObjectId(adminId),
      };

      if (projectId) {
        if (!Types.ObjectId.isValid(projectId)) {
          this.logger.error(`Invalid projectId provided: ${projectId}`);
          throw new BadRequestException('Invalid projectId provided');
        }
        filter.projectId = new Types.ObjectId(projectId);
      }

      this.logger.debug(`Fetching with filter: ${JSON.stringify(filter)}`);

      // Query database
      const docs = await this.model
        .find(filter)
        .populate('webinarId', 'webinarName webinarDate')
        .sort({ updatedAt: -1 })
        .lean();

      this.logger.log(`Found ${docs.length} webinar auto message(s)`);

      // Transform _id fields to id and extract webinar data
      const result = docs.map((doc: any) => {
        try {
          const webinar = doc.webinarId;
          return {
            ...doc,
            id: doc._id?.toString() || null,
            adminId: doc.adminId?.toString() || adminId,
            webinarId: webinar?._id
              ? webinar._id.toString()
              : doc.webinarId?.toString() || null,
            projectId: doc.projectId?.toString() || null,
            webinarName: webinar?.webinarName || 'Unknown Webinar',
            webinarDate: webinar?.webinarDate || null,
          };
        } catch (error) {
          this.logger.warn(
            `Error transforming document ${doc._id}: ${error.message}`,
          );
          // Return a safe fallback object
          return {
            id: doc._id?.toString() || null,
            adminId: doc.adminId?.toString() || adminId,
            webinarId: null,
            projectId: doc.projectId?.toString() || null,
            webinarName: 'Unknown Webinar',
            webinarDate: null,
            error: 'Failed to transform document',
          };
        }
      });

      this.logger.log(`Successfully transformed ${result.length} document(s)`);
      return result;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(
        `Error listing webinar auto messages: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        `Failed to list webinar auto messages: ${error.message}`,
      );
    }
  }

  private resolveVariables(
    mappings: VariableMappingDto[],
    contact: any,
  ): { values: string[]; dynamic: boolean[] } {
    const values: string[] = [];
    const dynamic: boolean[] = [];
    for (const m of mappings) {
      dynamic.push(!!m.isDynamic);
      if (m.isDynamic) {
        const field = (m.contactField || '').replace('$', '');
        const raw = contact?.[field];
        const value =
          typeof raw === 'string' && raw.trim().length > 0
            ? raw
            : m.fallbackValue || m.variable;
        values.push(value);
      } else {
        values.push(m.staticValue || m.fallbackValue || m.variable);
      }
    }
    return { values, dynamic };
  }

  async sendTest(adminId: string, dto: TestSendDto) {
    const project = await this.projectsService.findOne(
      new Types.ObjectId(adminId),
      new Types.ObjectId(dto.projectId),
    );
    if (!project) throw new NotFoundException('Project not found');

    const { values, dynamic } = this.resolveVariables(
      dto.variableMappings || [],
      {},
    );

    // Fetch template data from Meta to get the language
    let templateLanguage = dto.language || 'en_US'; // Default fallback
    try {
      const metaTemplates = await this.whatsappService.getTemplatesForWaba(
        new Types.ObjectId(adminId),
        new Types.ObjectId(dto.projectId),
        { name: dto.templateName },
      );

      if (metaTemplates && metaTemplates.length > 0) {
        const metaTemplate =
          metaTemplates.find((t) => t.name === dto.templateName) ||
          metaTemplates[0];
        templateLanguage = metaTemplate.language || dto.language || 'en_US';
        this.logger.log(
          `Retrieved template language from Meta: ${templateLanguage} for template: ${dto.templateName}`,
        );
      } else {
        this.logger.warn(
          `Template ${dto.templateName} not found in Meta. Using ${templateLanguage}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to fetch template language from Meta for ${dto.templateName}. Using ${templateLanguage}`,
        error.message,
      );
    }

    const res = await this.whatsappService.sendSingleTemplateMessage({
      adminId: new Types.ObjectId(adminId),
      projectId: dto.projectId,
      recipientPhoneNumber: dto.phoneNumber,
      templateName: dto.templateName,
      bodyVariables: values,
      headerMediaAssetId: dto.headerMediaAssetId,
      language: templateLanguage,
      contactId: undefined,
      messageType: WabaMessageType.INDIVIDUAL,
    });

    return res;
  }

  async sendForRegistration(
    adminId: string,
    webinarId: string,
    contact: {
      phoneNumber: string;
      email?: string;
      firstName?: string;
      lastName?: string;
      contactId?: string;
    },
  ) {
    const cfg = await this.getConfig(adminId, webinarId);
    if (!cfg || !cfg.enabled) return;

    const { values, dynamic } = this.resolveVariables(
      cfg.variableMappings as any,
      contact,
    );

    // Fetch template data from Meta to get the language
    let templateLanguage = cfg.language || 'en_US'; // Default fallback
    try {
      const metaTemplates = await this.whatsappService.getTemplatesForWaba(
        new Types.ObjectId(adminId),
        cfg.projectId,
        { name: cfg.templateName },
      );

      if (metaTemplates && metaTemplates.length > 0) {
        const metaTemplate =
          metaTemplates.find((t) => t.name === cfg.templateName) ||
          metaTemplates[0];
        templateLanguage = metaTemplate.language || cfg.language || 'en_US';
        this.logger.log(
          `Retrieved template language from Meta: ${templateLanguage} for template: ${cfg.templateName}`,
        );
      } else {
        this.logger.warn(
          `Template ${cfg.templateName} not found in Meta. Using ${templateLanguage}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to fetch template language from Meta for ${cfg.templateName}. Using ${templateLanguage}`,
        error.message,
      );
    }

    try {
      const res = await this.whatsappService.sendSingleTemplateMessage({
        adminId: new Types.ObjectId(adminId),
        projectId: cfg.projectId.toString(),
        recipientPhoneNumber: contact.phoneNumber,
        templateName: cfg.templateName,
        bodyVariables: values,
        headerMediaAssetId: cfg.headerMediaAssetId,
        language: templateLanguage,
        contactId: contact.contactId,
        messageType: WabaMessageType.AUTO_MESSAGE,
      });

      await this.model.updateOne(
        { _id: cfg._id },
        {
          $inc: { sent: 1 },
          $set: { lastSentAt: new Date(), lastError: null },
        },
      );
      return res;
    } catch (e: any) {
      await this.model.updateOne(
        { _id: cfg._id },
        {
          $inc: { failed: 1 },
          $set: { lastError: e?.message || 'send failed' },
        },
      );
      throw e;
    }
  }

  async delete(adminId: string, webinarId: string, projectId: string) {
    const filter = {
      adminId: new Types.ObjectId(adminId),
      webinarId: new Types.ObjectId(webinarId),
      projectId: new Types.ObjectId(projectId),
    };

    const result = await this.model.findOneAndDelete(filter);

    if (!result) {
      throw new NotFoundException('Auto message configuration not found');
    }

    return { message: 'Configuration deleted successfully' };
  }
}
