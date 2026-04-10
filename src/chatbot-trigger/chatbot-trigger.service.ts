import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ChatbotTrigger,
  ChatbotTriggerDocument,
} from './chatbot-trigger.schema';
import { CreateChatbotTriggerDto } from './dto/create-chatbot-trigger.dto';
import { UpdateChatbotTriggerDto } from './dto/update-chatbot-trigger.dto';

@Injectable()
export class ChatbotTriggerService {
  constructor(
    @InjectModel(ChatbotTrigger.name)
    private readonly chatbotTriggerModel: Model<ChatbotTriggerDocument>,
  ) {}

  async create(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    dto: CreateChatbotTriggerDto,
  ): Promise<ChatbotTriggerDocument> {
    const keyword = (dto.keyword || '').trim().toLowerCase();
    if (!keyword) {
      throw new BadRequestException('Keyword is required');
    }
    const existing = await this.chatbotTriggerModel.findOne({
      projectId,
      keyword,
    });
    if (existing) {
      throw new BadRequestException(
        `Trigger for keyword "${dto.keyword.trim()}" already exists`,
      );
    }
    const doc = await this.chatbotTriggerModel.create({
      adminId,
      projectId,
      keyword,
      responseType: dto.responseType,
      responseValue: (dto.responseValue || '').trim(),
      enabled: dto.enabled !== false,
    });
    return doc;
  }

  async findAllByProject(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
  ): Promise<ChatbotTriggerDocument[]> {
    return this.chatbotTriggerModel
      .find({ adminId, projectId })
      .sort({ createdAt: 1 })
      .lean()
      .exec() as Promise<ChatbotTriggerDocument[]>;
  }

  async update(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    triggerId: string,
    dto: UpdateChatbotTriggerDto,
  ): Promise<ChatbotTriggerDocument> {
    if (!Types.ObjectId.isValid(triggerId)) {
      throw new BadRequestException('Invalid trigger ID');
    }
    const trigger = await this.chatbotTriggerModel.findOne({
      _id: new Types.ObjectId(triggerId),
      adminId,
      projectId,
    });
    if (!trigger) {
      throw new NotFoundException('Trigger not found');
    }
    const update: Partial<ChatbotTrigger> = {};
    if (dto.keyword !== undefined) {
      update.keyword = (dto.keyword || '').trim().toLowerCase();
      if (!update.keyword) {
        throw new BadRequestException('Keyword cannot be empty');
      }
    }
    if (dto.responseType !== undefined) update.responseType = dto.responseType;
    if (dto.responseValue !== undefined)
      update.responseValue = (dto.responseValue || '').trim();
    if (dto.enabled !== undefined) update.enabled = dto.enabled;

    const updated = await this.chatbotTriggerModel
      .findByIdAndUpdate(triggerId, { $set: update }, { new: true })
      .exec();
    return updated as ChatbotTriggerDocument;
  }

  async delete(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    triggerId: string,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(triggerId)) {
      throw new BadRequestException('Invalid trigger ID');
    }
    const result = await this.chatbotTriggerModel.deleteOne({
      _id: new Types.ObjectId(triggerId),
      adminId,
      projectId,
    });
    if (result.deletedCount === 0) {
      throw new NotFoundException('Trigger not found');
    }
  }

  /**
   * Returns the first enabled trigger whose keyword is contained in the user message (substring match, case-insensitive).
   * E.g. keyword "join" matches "i like to join", "mujhe join kr na hai", or "join".
   */
  async findMatchingTrigger(
    projectId: Types.ObjectId,
    userMessageText: string,
  ): Promise<ChatbotTriggerDocument | null> {
    if (!userMessageText || typeof userMessageText !== 'string') {
      return null;
    }
    const normalized = userMessageText.trim().toLowerCase();
    if (!normalized) return null;

    const triggers = await this.chatbotTriggerModel
      .find({ projectId, enabled: true })
      .sort({ createdAt: 1 })
      .lean()
      .exec();

    const match = (triggers as ChatbotTriggerDocument[]).find((t) =>
      normalized.includes(t.keyword),
    );
    return match ?? null;
  }
}
