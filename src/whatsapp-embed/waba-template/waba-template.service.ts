import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  WabaTemplate,
  // WabaTemplateButton,
  WabaTemplateCategory,
  // WabaTemplateComponent,
  WabaTemplateDocument,
  WabaTemplateQuality,
  WabaTemplateStatus,
} from './waba-template.schema';
import { WhatsappService } from 'src/whatsapp/whatsapp.service';
import {
  CreateTemplateDto,
  DeleteTemplateDto,
  TemplateResponseDto,
} from 'src/whatsapp/dto/template.dto';
import { GetTemplatesQueryDto } from 'src/whatsapp/dto/template.dto';

@Injectable()
export class WabaTemplateService {
  private readonly logger = new Logger(WabaTemplateService.name);

  constructor(
    @InjectModel(WabaTemplate.name)
    private wabaTemplateModel: Model<WabaTemplateDocument>,
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsappService: WhatsappService,
  ) {}

  async syncWabaTemplates(adminId: Types.ObjectId, projectId: Types.ObjectId) {
    const now = new Date();
    this.logger.log(`Syncing WABA templates for project ${projectId}`);

    // Step 1: Fetch templates from Meta
    let wabaTemplates: TemplateResponseDto[] = [];
    try {
      wabaTemplates = await this.whatsappService.getTemplatesForWaba(
        adminId,
        projectId,
      );
    } catch (error) {
      this.logger.error(
        `Failed to fetch templates from WhatsApp for project ${projectId}`,
        error?.response?.data || error?.message || error,
      );
      throw error;
    }

    if (!Array.isArray(wabaTemplates)) {
      wabaTemplates = [];
    }

    const bulkOps: any[] = [];
    const seenKeys = new Set<string>();
    const metaTemplateIds: string[] = [];
    let skippedMissing = 0;
    let skippedDuplicate = 0;

    for (const tpl of wabaTemplates) {
      const name = tpl.name;
      const language = tpl.language;

      if (!name || !language || !tpl.id) {
        skippedMissing += 1;
        this.logger.warn(
          `Skipping template with missing name, language, or id: ${JSON.stringify(tpl)}`,
        );
        continue;
      }
      
      metaTemplateIds.push(tpl.id);

      const key = `${name}::${language}`;
      if (seenKeys.has(key)) {
        skippedDuplicate += 1;
        this.logger.warn(
          `Skipping duplicate template from Meta for key ${key}`,
        );
        continue;
      }
      seenKeys.add(key);

      const templateDoc = {
        projectId,
        adminId,
        ...this.mapTemplateToSchema(tpl, now),
      };

      bulkOps.push({
        updateOne: {
          filter: { projectId, name, language },
          update: { $set: templateDoc },
          upsert: true,
        },
      });
    }

    this.logger.log(
      `Prepared ${bulkOps.length} templates for upsertion (skipped missing=${skippedMissing}, duplicates=${skippedDuplicate}) for project ${projectId}`,
    );

    let upsertedCount = 0;
    let modifiedCount = 0;
    
    if (bulkOps.length > 0) {
      try {
        const bulkResult = await this.wabaTemplateModel.bulkWrite(bulkOps, {
          ordered: false,
        });
        upsertedCount = bulkResult.upsertedCount || 0;
        modifiedCount = bulkResult.modifiedCount || 0;
      } catch (error: any) {
        this.logger.error(
          `Failed to bulk write templates for project ${projectId}. Proceeding to cleanup...`,
          error?.message,
        );
      }
    }

    let deletedCount = 0;
    try {
      const deleteResult = await this.wabaTemplateModel.deleteMany({
        projectId,
        id: { $nin: metaTemplateIds },
      });
      deletedCount = deleteResult.deletedCount || 0;
      if (deletedCount > 0) {
        this.logger.log(`Cleaned up ${deletedCount} orphaned templates for project ${projectId}`);
      }
    } catch (error: any) {
      this.logger.error(
        `Failed to clean up orphaned templates for project ${projectId}`,
        error?.message,
      );
    }

    this.logger.log(
      `WABA template sync completed for project ${projectId}: fetched=${wabaTemplates.length}, upserted=${upsertedCount}, modified=${modifiedCount}, deleted=${deletedCount}`,
    );

    return {
      fetched: wabaTemplates.length,
      upserted: upsertedCount,
      modified: modifiedCount,
      deleted: deletedCount,
    };
  }

  async getTemplatesFromDb(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    query: GetTemplatesQueryDto,
  ) {
    const filter: any = {
      projectId,
      adminId,
      is_deleted: false,
    };

    if (query?.status) {
      filter.status = String(query.status).toUpperCase();
    }
    if (query?.category) {
      filter.category = String(query.category).toUpperCase();
    }
    if (query?.language) {
      filter.language = query.language;
    }

    try {
      const templates = await this.wabaTemplateModel.find(filter).lean();
      this.logger.log(
        `Fetched ${templates.length} templates from DB for project ${projectId}`,
      );
      return templates;
    } catch (error) {
      this.logger.error(
        `Failed to fetch templates from DB for project ${projectId}`,
        error?.message || error,
      );
      throw error;
    }
  }

  async createTemplate(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    createTemplateDto: CreateTemplateDto,
  ) {
    const result = await this.whatsappService.createTemplateForWaba(
      adminId,
      projectId,
      createTemplateDto,
    );
    try {
      await this.syncWabaTemplates(adminId, projectId);
    } catch (error) {
      this.logger.error(
        `Template created on Meta, but failed to sync locally for project ${projectId}. Error: ${error.message || error}`,
      );
    }
    return result;
  }

  async deleteTemplate(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    deleteTemplateDto: DeleteTemplateDto,
  ) {
    const result = await this.whatsappService.deleteTemplateForWaba(
      adminId,
      projectId,
      deleteTemplateDto,
    );
    try {
      await this.syncWabaTemplates(adminId, projectId);
    } catch (error) {
      this.logger.error(
        `Template deleted on Meta, but failed to sync locally for project ${projectId}. Error: ${error.message || error}`,
      );
    }
    return result;
  }

  private mapTemplateToSchema(tpl: TemplateResponseDto, now: Date) {
    const components = Array.isArray(tpl.components) ? tpl.components : [];

    return {
      id: tpl.id,
      name: tpl.name,
      language: tpl.language,
      category: this.mapCategory(tpl.category),
      status: this.mapStatus(tpl.status),
      quality_score: tpl.quality_score,
      rejected_reason: tpl.rejected_reason,
      components,
      is_deleted: false,
      is_active: true,
      last_synced_at: now,
      raw: tpl,
    };
  }

  private mapCategory(category: any): WabaTemplateCategory {
    if (
      Object.values(WabaTemplateCategory).includes(
        category as WabaTemplateCategory,
      )
    ) {
      return category as WabaTemplateCategory;
    }
    return WabaTemplateCategory.MARKETING;
  }

  private mapStatus(status: any): WabaTemplateStatus {
    const upper = typeof status === 'string' ? status.toUpperCase() : '';
    if (
      Object.values(WabaTemplateStatus).includes(upper as WabaTemplateStatus)
    ) {
      return upper as WabaTemplateStatus;
    }
    return WabaTemplateStatus.PENDING;
  }

  private mapQuality(quality: any): WabaTemplateQuality {
    const score =
      typeof quality === 'string'
        ? quality.toUpperCase()
        : typeof quality === 'object' && quality?.score
          ? String(quality.score).toUpperCase()
          : 'UNKNOWN';

    if (
      Object.values(WabaTemplateQuality).includes(score as WabaTemplateQuality)
    ) {
      return score as WabaTemplateQuality;
    }
    return WabaTemplateQuality.UNKNOWN;
  }

  // private mapComponent(component: any): WabaTemplateComponent {
  //     const mapped: WabaTemplateComponent = {
  //         type: component?.type,
  //         format: component?.format || 'TEXT',
  //         text: component?.text,
  //         examples: component?.examples,
  //         variable_count: component?.variable_count,
  //         buttons: component?.buttons,
  //     };
  //     return mapped;
  // }

  private mapExamples(example: any): string[] {
    if (!example) return [];
    if (Array.isArray(example)) return example.map((e) => String(e));
    if (Array.isArray(example.body_text)) {
      return example.body_text.flat().map((e: any) => String(e));
    }
    if (Array.isArray(example.header_text)) {
      return example.header_text.map((e: any) => String(e));
    }
    return [];
  }

  // private mapButton(button: any): WabaTemplateButton {
  //     return {
  //         type: button?.type,
  //         text: button?.text,
  //         url: button?.url,
  //         phone_number: button?.phone_number,
  //         example: button?.example,
  //     };
  // }

  private countVariables(text?: string): number {
    if (!text) return 0;
    const matches = text.match(/{{\d+}}/g);
    return matches ? matches.length : 0;
  }

  async getPendingWabaTemplateAdminProjectPairs(): Promise<
    Array<{ adminId: Types.ObjectId; projectId: Types.ObjectId }>
  > {
    return this.wabaTemplateModel
      .aggregate([
        {
          $match: {
            status: WabaTemplateStatus.PENDING,
            is_deleted: false,
            is_active: true,
          },
        },
        {
          $group: {
            _id: { adminId: '$adminId', projectId: '$projectId' },
          },
        },
        {
          $project: {
            _id: 0,
            adminId: '$_id.adminId',
            projectId: '$_id.projectId',
          },
        },
      ])
      .exec();
  }

  /**
   * Cron job ke liye: agar DB mein pending WABA templates hain
   * to unke admin+project pairs ko loop karke Meta se sync karega.
   */
  async syncPendingWabaTemplates(): Promise<{
    pendingPairsCount: number;
    syncedCount: number;
    failedCount: number;
    elapsedMs: number;
  }> {
    const startedAt = Date.now();

    const pendingPairs = await this.getPendingWabaTemplateAdminProjectPairs();

    if (pendingPairs.length === 0) {
      return {
        pendingPairsCount: 0,
        syncedCount: 0,
        failedCount: 0,
        elapsedMs: Date.now() - startedAt,
      };
    }

    let syncedCount = 0;
    let failedCount = 0;

    for (const pair of pendingPairs) {
      try {
        await this.syncWabaTemplates(pair.adminId, pair.projectId);
        syncedCount += 1;
      } catch (error) {
        failedCount += 1;
        this.logger.error(
          `Pending WABA template sync failed for project=${pair.projectId} admin=${pair.adminId}`,
          (error as any)?.response?.data || (error as any)?.message || error,
        );
      }
    }

    return {
      pendingPairsCount: pendingPairs.length,
      syncedCount,
      failedCount,
      elapsedMs: Date.now() - startedAt,
    };
  }

  async getByTemplateName(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    templateName: string,
    language?: string,
  )
  : Promise<WabaTemplateDocument | null> 
  
  {
    return this.wabaTemplateModel
      .findOne({
        projectId,
        adminId,
        name: templateName,
        ...(language ? { language: { $in: [language, language.replace('-', '_')] } } : {}),
      })
      .lean();
  }
}
