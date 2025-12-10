import { Injectable, Logger } from '@nestjs/common';
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

    // Step 2: Delete all existing templates for this project
    let deletedCount = 0;
    try {
      const deleteResult = await this.wabaTemplateModel.deleteMany({
        projectId,
      });
      deletedCount = deleteResult.deletedCount || 0;
      this.logger.log(
        `Deleted ${deletedCount} existing templates for project ${projectId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to delete existing templates for project ${projectId}`,
        error?.message || error,
      );
      throw error;
    }

    // Step 3: If no templates from Meta, return early
    if (!Array.isArray(wabaTemplates) || wabaTemplates.length === 0) {
      this.logger.warn(
        `No templates returned from Meta for project ${projectId}`,
      );
      return { fetched: 0, inserted: 0, deleted: deletedCount };
    }

    // Step 4: Prepare new templates for insertion (dedupe by name+language)
    const templatesToInsert: any[] = [];
    const seenKeys = new Set<string>();
    let skippedMissing = 0;
    let skippedDuplicate = 0;

    for (const tpl of wabaTemplates) {
      const name = tpl.name;
      const language = tpl.language;

      if (!name || !language) {
        skippedMissing += 1;
        this.logger.warn(
          `Skipping template with missing name or language: ${JSON.stringify(tpl)}`,
        );
        continue;
      }

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

      templatesToInsert.push(templateDoc);
    }

    this.logger.log(
      `Prepared ${templatesToInsert.length} templates for insertion (skipped missing=${skippedMissing}, duplicates=${skippedDuplicate}) for project ${projectId}`,
    );

    // Step 5: Insert all new templates
    let insertedCount = 0;
    if (templatesToInsert.length > 0) {
      try {
        const insertResult = await this.wabaTemplateModel.insertMany(
          templatesToInsert,
          {
            ordered: false,
          },
        );
        insertedCount = insertResult.length;
        this.logger.log(
          `Inserted ${insertedCount} new templates for project ${projectId}`,
        );
      } catch (error: any) {
        // Log detailed error information for debugging
        this.logger.error(
          `Failed to insert templates for project ${projectId}`,
          {
            message: error?.message,
            name: error?.name,
            code: error?.code,
            errors: error?.errors,
            writeErrors: error?.writeErrors,
            insertedDocs: error?.insertedDocs,
            nInserted: error?.nInserted,
          },
        );

        // Log first template that failed for debugging
        if (templatesToInsert.length > 0) {
          this.logger.error(
            `Sample template that failed: ${JSON.stringify(templatesToInsert[0], null, 2)}`,
          );
        }

        // If insert fails, templates remain deleted (clean state)
        throw error;
      }
    } else {
      this.logger.warn(
        `No templates prepared for insertion for project ${projectId}`,
      );
    }

    this.logger.log(
      `WABA template sync completed for project ${projectId}: fetched=${wabaTemplates.length}, inserted=${insertedCount}, deleted=${deletedCount}`,
    );

    return {
      fetched: wabaTemplates.length,
      inserted: insertedCount,
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
    await this.whatsappService.createTemplateForWaba(
      adminId,
      projectId,
      createTemplateDto,
    );
    await this.syncWabaTemplates(adminId, projectId);
  }

  async deleteTemplate(adminId: Types.ObjectId, projectId: Types.ObjectId, deleteTemplateDto: DeleteTemplateDto) {
    await this.whatsappService.deleteTemplateForWaba(adminId, projectId, deleteTemplateDto);
    await this.syncWabaTemplates(adminId, projectId);
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
}
