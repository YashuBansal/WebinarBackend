import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { WebinarAutoMessage, WebinarAutoMessageDocument } from './webinar-auto-message.schema';
import { UpsertAutoMessageDto, TestSendDto, VariableMappingDto } from './dto';
import { WhatsappService } from 'src/whatsapp/whatsapp.service';
import { ProjectsService } from 'src/projects/projects.service';
import { WabaMessageService } from 'src/whatsapp-embed/waba-message/waba-message.service';
import { WabaMessageType } from 'src/schemas/whatsapp-embed/waba-message.schema';

@Injectable()
export class WebinarAutoMessageService {
  constructor(
    @InjectModel(WebinarAutoMessage.name) private model: Model<WebinarAutoMessageDocument>,
    private readonly whatsappService: WhatsappService,
    private readonly projectsService: ProjectsService,
  ) {}

  async getConfig(adminId: string,  webinarId: string) {
    return this.model.findOne({
      adminId: new Types.ObjectId(adminId),
      webinarId: new Types.ObjectId(webinarId),
    }).lean();
  }

  async upsert(adminId: string, dto: UpsertAutoMessageDto) {
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
    const doc = await this.model.findOneAndUpdate(filter, update, { upsert: true, new: true });
    return doc;
  }

  async list(adminId: string, projectId?: string) {
    const filter: any = { adminId: new Types.ObjectId(adminId) };
    if (projectId) filter.projectId = new Types.ObjectId(projectId);
    console.log(filter);
    const docs = await this.model
      .find(filter)
      .sort({ updatedAt: -1 })
      .lean();
    return docs;
  }

  private resolveVariables(mappings: VariableMappingDto[], contact: any): { values: string[]; dynamic: boolean[] } {
    const values: string[] = [];
    const dynamic: boolean[] = [];
    for (const m of mappings) {
      dynamic.push(!!m.isDynamic);
      if (m.isDynamic) {
        const field = (m.contactField || '').replace('$', '');
        const raw = contact?.[field];
        const value = (typeof raw === 'string' && raw.trim().length > 0) ? raw : (m.fallbackValue || m.variable);
        values.push(value);
      } else {
        values.push(m.staticValue || m.fallbackValue || m.variable);
      }
    }
    return { values, dynamic };
  }

  async sendTest(adminId: string, dto: TestSendDto) {
    const project = await this.projectsService.findOne(new Types.ObjectId(adminId), new Types.ObjectId(dto.projectId));
    if (!project) throw new NotFoundException('Project not found');

    const { values, dynamic } = this.resolveVariables(dto.variableMappings || [], {});

    const res = await this.whatsappService.sendSingleTemplateMessage(
      {
        adminId: new Types.ObjectId(adminId),
        projectId: dto.projectId,
        recipientPhoneNumber: dto.phoneNumber,
        templateName: dto.templateName,
        bodyVariables: values,
        headerMediaAssetId: dto.headerMediaAssetId,
        language: dto.language || 'en_US',
        contactId: undefined,
        messageType: WabaMessageType.INDIVIDUAL,
      }
    );

    return res;
  }

  async sendForRegistration(adminId: string,     webinarId: string, contact: { phoneNumber: string; email?: string; firstName?: string; lastName?: string; contactId?: string }) {
    const cfg = await this.getConfig(adminId, webinarId);
    if (!cfg || !cfg.enabled) return;

    const { values, dynamic } = this.resolveVariables(cfg.variableMappings as any, contact);

    try {
      const res = await this.whatsappService.sendSingleTemplateMessage(
      {
        adminId: new Types.ObjectId(adminId),
        projectId: cfg.projectId.toString(),
        recipientPhoneNumber: contact.phoneNumber,
        templateName: cfg.templateName,
        bodyVariables: values,
        headerMediaAssetId: cfg.headerMediaAssetId,
        language: cfg.language || 'en_US',
        contactId: contact.contactId,
        messageType: WabaMessageType.AUTO_MESSAGE,
      }
      );

      await this.model.updateOne({ _id: cfg._id }, { $inc: { sent: 1 }, $set: { lastSentAt: new Date(), lastError: null } });
      return res;
    } catch (e: any) {
      await this.model.updateOne({ _id: cfg._id }, { $inc: { failed: 1 }, $set: { lastError: e?.message || 'send failed' } });
      throw e;
    }
  }
}


