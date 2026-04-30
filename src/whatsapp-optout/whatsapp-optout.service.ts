import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  WhatsappOptout,
  WhatsappOptoutDocument,
} from 'src/whatsapp/schemas/whatsapp-optout.schema';

@Injectable()
export class WhatsappOptoutService {
  constructor(
    @InjectModel(WhatsappOptout.name)
    private readonly whatsappOptoutModel: Model<WhatsappOptoutDocument>,
  ) {}

  normalizePhone(input: string): string {
    const raw = `${input || ''}`.trim();
    const digitsOnly = raw.replace(/\D/g, '');

    if (/^0\d{10}$/.test(digitsOnly)) return `+91${digitsOnly.slice(1)}`;
    if (/^\d{10}$/.test(digitsOnly)) return `+91${digitsOnly}`;
    if (/^91\d{10}$/.test(digitsOnly)) return `+${digitsOnly}`;
    if (/^\+91\d{10}$/.test(raw)) return raw;
    return raw;
  }

  async isOptedOut(
    projectId: Types.ObjectId | string,
    phoneNumber: string,
  ): Promise<boolean> {
    const normalizedPhone = this.normalizePhone(phoneNumber);
    const existing = await this.whatsappOptoutModel
      .findOne({
        projectId: new Types.ObjectId(projectId),
        phoneNumber: normalizedPhone,
      })
      .lean()
      .exec();
    return !!existing;
  }

  async addToOptOutList(
    projectId: Types.ObjectId | string,
    phoneNumber: string,
    reason = 'stop_keyword',
  ): Promise<void> {
    const normalizedPhone = this.normalizePhone(phoneNumber);
    await this.whatsappOptoutModel.updateOne(
      {
        projectId: new Types.ObjectId(projectId),
        phoneNumber: normalizedPhone,
      },
      {
        $setOnInsert: {
          projectId: new Types.ObjectId(projectId),
          phoneNumber: normalizedPhone,
          reason,
        },
      },
      { upsert: true },
    );
  }

  async listByProject(
    projectId: string,
    page = 1,
    limit = 20,
    startDate?: string,
    endDate?: string,
  ): Promise<{ items: WhatsappOptoutDocument[]; total: number }> {
    const skip = (Math.max(page, 1) - 1) * Math.max(limit, 1);
    const projectObjectId = new Types.ObjectId(projectId);
    const query: Record<string, unknown> = { projectId: projectObjectId };

    if (startDate || endDate) {
      const createdAt: Record<string, Date> = {};

      if (startDate) {
        const start = new Date(startDate);
        if (!Number.isNaN(start.getTime())) {
          createdAt.$gte = start;
        }
      }

      if (endDate) {
        const end = new Date(endDate);
        if (!Number.isNaN(end.getTime())) {
          end.setHours(23, 59, 59, 999);
          createdAt.$lte = end;
        }
      }

      if (Object.keys(createdAt).length > 0) {
        query.createdAt = createdAt;
      }
    }

    const [items, total] = await Promise.all([
      this.whatsappOptoutModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.whatsappOptoutModel.countDocuments(query),
    ]);
    return { items: items as WhatsappOptoutDocument[], total };
  }

  async optIn(projectId: string, optoutId: string): Promise<boolean> {
    const result = await this.whatsappOptoutModel
      .deleteOne({
        _id: new Types.ObjectId(optoutId),
        projectId: new Types.ObjectId(projectId),
      })
      .exec();
    return (result.deletedCount || 0) > 0;
  }

  /** Removes opt-out by phone (e.g. user replied START). Returns true if a row existed. */
  async removeByPhoneForProject(
    projectId: Types.ObjectId | string,
    phoneNumber: string,
  ): Promise<boolean> {
    const normalizedPhone = this.normalizePhone(phoneNumber);
    const result = await this.whatsappOptoutModel
      .deleteOne({
        projectId: new Types.ObjectId(projectId),
        phoneNumber: normalizedPhone,
      })
      .exec();
    return (result.deletedCount || 0) > 0;
  }
}
