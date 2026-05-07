import {
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

  private async getGlobalConfigDocument() {
    const globalByScope = await this.model
      .findOne({ scope: 'global' })
      .sort({ updatedAt: -1 })
      .lean();
    if (globalByScope) return globalByScope;

    return this.model.findOne({}).sort({ updatedAt: -1 }).lean();
  }

  async getConfig(_projectId?: string) {
    return this.getGlobalConfigDocument();
  }

  async upsert(adminId: string, ownerEmail: string, dto: UpsertAlarmWhatsappConfigDto) {
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

    const current = await this.getGlobalConfigDocument();

    const update = {
      scope: 'global',
      adminId: new Types.ObjectId(adminId),
      projectId: new Types.ObjectId(dto.projectId),
      ownerEmail: ownerEmail.trim().toLowerCase(),
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

    if (current?._id) {
      return this.model.findByIdAndUpdate(current._id, update, { new: true });
    }

    return this.model.create(update);
  }

  async list(projectId?: string) {
    const docs = (
      await this.model.find({}).sort({ updatedAt: -1 }).limit(1).lean()
    ).filter((doc: any) =>
      projectId ? doc?.projectId?.toString() === projectId : true,
    );

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

  async sendTest(dto: TestSendAlarmWhatsappConfigDto) {
    const cfg = await this.getGlobalConfigDocument();
    if (!cfg || !cfg.enabled) {
      throw new NotFoundException('Alarm WhatsApp configuration not found');
    }

    const senderAdminId = cfg?.adminId?.toString();
    const senderProjectId = cfg?.projectId?.toString();
    if (!senderAdminId || !senderProjectId) {
      throw new NotFoundException('Alarm WhatsApp sender context not configured');
    }

    const selected = this.getTemplateByType(cfg, dto.type);
    const { values } = this.resolveVariables(
      selected.variableMappings as any,
      {},
    );

    return this.whatsappService.sendTemplateMessagev2({
      adminId: senderAdminId,
      messageType: WabaMessageType.ALARM,
      sendTemplateDto: {
        projectId: senderProjectId,
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
    const { type, contact } = params;
    const cfg = await this.getGlobalConfigDocument();
    if (!cfg || !cfg.enabled) {
      this.logger.warn(
        `Alarm WhatsApp global config missing/disabled.`,
      );
      return null;
    }

    const senderAdminId = cfg?.adminId?.toString();
    const senderProjectId = cfg?.projectId?.toString();
    if (!senderAdminId || !senderProjectId) {
      this.logger.warn(
        `Alarm WhatsApp sender context missing in global configuration.`,
      );
      return null;
    }

    const project = await this.projectsService.findOne(
      new Types.ObjectId(senderAdminId),
      new Types.ObjectId(senderProjectId),
    );
    if (!project || (project as any).isDeleted) {
      this.logger.warn(
        `Skipping alarm template send for project ${senderProjectId} because project is deleted or not accessible`,
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
        `Sending ${type} alarm template "${selected.templateName}" for admin ${senderAdminId}, project ${senderProjectId}, phone ${contact.phoneNumber}.`,
      );
      const res = await this.whatsappService.sendTemplateMessagev2({
        adminId: senderAdminId,
        messageType: WabaMessageType.ALARM,
        sendTemplateDto: {
          projectId: senderProjectId,
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
        `Failed to send ${type} alarm template message for admin ${senderAdminId}, project ${senderProjectId}: ${error?.message}`,
      );
      return null;
    }
  }

  async delete(_id: string) {
    const filter = {
      _id: new Types.ObjectId(_id),
    };

    const result = await this.model.findOneAndDelete(filter);
    if (!result) {
      throw new NotFoundException('Alarm WhatsApp configuration not found');
    }
    return { message: 'Configuration deleted successfully' };
  }

  async toggle(_id: string, enabled: boolean) {
    const filter = {
      _id: new Types.ObjectId(_id),
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
