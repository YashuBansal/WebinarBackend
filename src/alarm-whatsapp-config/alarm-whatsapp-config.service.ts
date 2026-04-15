import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AlarmWhatsappConfig,
  AlarmWhatsappConfigDocument,
} from './alarm-whatsapp-config.schema';
import {
  TestSendAlarmWhatsappConfigDto,
  UpsertAlarmWhatsappConfigDto,
  VariableMappingDto,
} from './dto';
import { WhatsappService } from 'src/whatsapp/whatsapp.service';
import { ProjectsService } from 'src/projects/projects.service';
import { WabaMessageType } from 'src/whatsapp-embed/waba-message/waba-message.schema';

type AlarmMessageType = 'main' | 'reminder';

@Injectable()
export class AlarmWhatsappConfigService {
  private readonly logger = new Logger(AlarmWhatsappConfigService.name);

  constructor(
    @InjectModel(AlarmWhatsappConfig.name)
    private model: Model<AlarmWhatsappConfigDocument>,
    private readonly whatsappService: WhatsappService,
    private readonly projectsService: ProjectsService,
  ) {}

  async getConfig(adminId: string, projectId: string) {
    return this.model
      .findOne({
        adminId: new Types.ObjectId(adminId),
        projectId: new Types.ObjectId(projectId),
      })
      .lean();
  }

  async upsert(adminId: string, dto: UpsertAlarmWhatsappConfigDto) {
    await this.whatsappService.checkVariableMappingLength({
      adminId,
      projectId: dto.projectId,
      templateName: dto.mainAlarmTemplateName,
      givenVariableLength: dto.mainAlarmVariableMappings?.length || 0,
      headerMediaAssetId: dto.mainAlarmHeaderMediaAssetId,
    });

    await this.whatsappService.checkVariableMappingLength({
      adminId,
      projectId: dto.projectId,
      templateName: dto.reminderTemplateName,
      givenVariableLength: dto.reminderVariableMappings?.length || 0,
      headerMediaAssetId: dto.reminderHeaderMediaAssetId,
    });

    const filter = {
      adminId: new Types.ObjectId(adminId),
      projectId: new Types.ObjectId(dto.projectId),
    };

    const update = {
      ...filter,
      enabled: dto.enabled ?? true,
      mainAlarmTemplateName: dto.mainAlarmTemplateName,
      mainAlarmLanguage: dto.mainAlarmLanguage || 'en_US',
      mainAlarmHeaderMediaAssetId: dto.mainAlarmHeaderMediaAssetId || null,
      mainAlarmVariableMappings: dto.mainAlarmVariableMappings || [],
      reminderTemplateName: dto.reminderTemplateName,
      reminderLanguage: dto.reminderLanguage || 'en_US',
      reminderHeaderMediaAssetId: dto.reminderHeaderMediaAssetId || null,
      reminderVariableMappings: dto.reminderVariableMappings || [],
    };

    return this.model.findOneAndUpdate(filter, update, {
      upsert: true,
      new: true,
    });
  }

  async list(adminId: string, projectId?: string) {
    if (!adminId || !Types.ObjectId.isValid(adminId)) {
      throw new BadRequestException('Invalid adminId provided');
    }

    const filter: any = {
      adminId: new Types.ObjectId(adminId),
    };

    if (projectId) {
      if (!Types.ObjectId.isValid(projectId)) {
        throw new BadRequestException('Invalid projectId provided');
      }
      filter.projectId = new Types.ObjectId(projectId);
    }

    const docs = await this.model.find(filter).sort({ updatedAt: -1 }).lean();

    return docs.map((doc: any) => ({
      ...doc,
      id: doc._id?.toString(),
      adminId: doc.adminId?.toString(),
      projectId: doc.projectId?.toString(),
    }));
  }

  private resolveVariables(
    mappings: VariableMappingDto[],
    contact: Record<string, any>,
  ): { values: string[] } {
    const values: string[] = [];
    for (const m of mappings || []) {
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

    return { values };
  }

  private getTemplateByType(cfg: any, type: AlarmMessageType) {
    if (type === 'main') {
      return {
        templateName: cfg.mainAlarmTemplateName,
        language: cfg.mainAlarmLanguage || 'en_US',
        headerMediaAssetId: cfg.mainAlarmHeaderMediaAssetId,
        variableMappings: cfg.mainAlarmVariableMappings || [],
      };
    }

    return {
      templateName: cfg.reminderTemplateName,
      language: cfg.reminderLanguage || 'en_US',
      headerMediaAssetId: cfg.reminderHeaderMediaAssetId,
      variableMappings: cfg.reminderVariableMappings || [],
    };
  }

  async sendTest(adminId: string, dto: TestSendAlarmWhatsappConfigDto) {
    const cfg = await this.getConfig(adminId, dto.projectId);
    if (!cfg || !cfg.enabled) {
      throw new NotFoundException('Alarm WhatsApp configuration not found');
    }

    const selected = this.getTemplateByType(cfg, dto.type);
    const { values } = this.resolveVariables(
      selected.variableMappings as any,
      {},
    );

    return this.whatsappService.sendTemplateMessagev2({
      adminId,
      messageType: WabaMessageType.ALARM,
      sendTemplateDto: {
        projectId: dto.projectId,
        recipients: [
          {
            recipientPhoneNumber: dto.phoneNumber,
            contactId: undefined,
            bodyVariables: values,
          },
        ],
        templateName: selected.templateName,
        headerMediaAssetId: selected.headerMediaAssetId,
        language: selected.language,
      },
    });
  }

  async sendForAlarm(params: {
    adminId: string;
    projectId?: string;
    type: AlarmMessageType;
    contact: {
      phoneNumber: string;
      contactId?: string;
      userName?: string;
      email?: string;
      note?: string;
      reminderType?: string;
      alarmDate?: string;
    };
  }) {
    const { adminId, type, contact } = params;
    let { projectId } = params;

    if (!projectId) {
      const configs = await this.model
        .find({
          adminId: new Types.ObjectId(adminId),
          enabled: true,
        })
        .sort({ updatedAt: -1 })
        .limit(2)
        .lean();

      if (!configs.length) {
        this.logger.warn(
          `No enabled alarm WhatsApp config found for admin ${adminId}.`,
        );
        return null;
      }

      projectId = configs[0]?.projectId?.toString();

      if (configs.length > 1) {
        this.logger.warn(
          `Multiple enabled alarm configs found for admin ${adminId}; using latest project ${projectId}.`,
        );
      }
    }

    if (!projectId) return null;
    const cfg = await this.getConfig(adminId, projectId);
    if (!cfg || !cfg.enabled) {
      this.logger.warn(
        `Alarm WhatsApp config missing/disabled for admin ${adminId} project ${projectId}.`,
      );
      return null;
    }

    const project = await this.projectsService.findOne(
      new Types.ObjectId(adminId),
      new Types.ObjectId(projectId),
    );
    if (!project || (project as any).isDeleted) {
      this.logger.warn(
        `Skipping alarm template send for project ${projectId} because project is deleted or not accessible`,
      );
      return null;
    }

    const selected = this.getTemplateByType(cfg, type);
    const { values } = this.resolveVariables(
      selected.variableMappings as any,
      contact,
    );

    try {
      this.logger.log(
        `Sending ${type} alarm template "${selected.templateName}" for admin ${adminId}, project ${projectId}, phone ${contact.phoneNumber}.`,
      );
      const res = await this.whatsappService.sendTemplateMessagev2({
        adminId,
        messageType: WabaMessageType.ALARM,
        sendTemplateDto: {
          projectId,
          recipients: [
            {
              recipientPhoneNumber: contact.phoneNumber,
              contactId: contact.contactId,
              bodyVariables: values,
            },
          ],
          templateName: selected.templateName,
          headerMediaAssetId: selected.headerMediaAssetId,
          language: selected.language,
        },
      });

      const successUpdate =
        type === 'main'
          ? { $inc: { mainAlarmSent: 1 } }
          : { $inc: { reminderSent: 1 } };

      await this.model.updateOne(
        { _id: cfg._id },
        {
          ...successUpdate,
          $set: { lastError: null },
        },
      );

      return res;
    } catch (error: any) {
      const failUpdate =
        type === 'main'
          ? { $inc: { mainAlarmFailed: 1 } }
          : { $inc: { reminderFailed: 1 } };

      await this.model.updateOne(
        { _id: cfg._id },
        {
          ...failUpdate,
          $set: { lastError: error?.message || 'send failed' },
        },
      );
      this.logger.error(
        `Failed to send ${type} alarm template message for admin ${adminId}, project ${projectId}: ${error?.message}`,
      );
      return null;
    }
  }

  async delete(adminId: string, _id: string) {
    const filter = {
      _id: new Types.ObjectId(_id),
      adminId: new Types.ObjectId(adminId),
    };

    const result = await this.model.findOneAndDelete(filter);
    if (!result) {
      throw new NotFoundException('Alarm WhatsApp configuration not found');
    }
    return { message: 'Configuration deleted successfully' };
  }

  async toggle(adminId: string, _id: string, enabled: boolean) {
    const filter = {
      _id: new Types.ObjectId(_id),
      adminId: new Types.ObjectId(adminId),
    };

    const result = await this.model.findOneAndUpdate(
      filter,
      { $set: { enabled } },
      { new: true },
    );

    if (!result) {
      throw new NotFoundException('Alarm WhatsApp configuration not found');
    }

    return result;
  }
}
