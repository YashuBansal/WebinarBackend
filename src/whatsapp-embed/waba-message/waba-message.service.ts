import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model, Types } from 'mongoose';
import {
  WabaMessage,
  WabaMessageDocument,
} from '../../schemas/whatsapp-embed/waba-message.schema';

@Injectable()
export class WabaMessageService {
  constructor(
    @InjectModel(WabaMessage.name)
    private wabaMessageModel: Model<WabaMessageDocument>,
  ) { }

  async create(wabaMessageData: {
    projectId: string;
    adminId: string;
    campaignId?: string;
    contactId?: string;
    wabaMessageId: string;
    messageType?: string;
    templateName: string;
  }): Promise<WabaMessage> {
    const wabaMessage = new this.wabaMessageModel({
      ...wabaMessageData,
      projectId: new Types.ObjectId(wabaMessageData.projectId),
      adminId: new Types.ObjectId(wabaMessageData.adminId),
      campaignId: mongoose.isValidObjectId(wabaMessageData.campaignId) ? new Types.ObjectId(wabaMessageData.campaignId) : undefined,
      contactId: mongoose.isValidObjectId(wabaMessageData.contactId) ? new Types.ObjectId(wabaMessageData.contactId) : undefined,
      messageType: wabaMessageData.messageType || 'individual',
    });

    return wabaMessage.save();
  }


  async findPaginatedAll(query:
    {
      projectId?: Types.ObjectId,
      adminId?: Types.ObjectId,
      campaignId?: Types.ObjectId,
      contactId?: Types.ObjectId,
      messageType?: string,
      templateName?: string,
    },
    paginationOptions: {
      page: number,
      limit: number,
    }
  ) {

    const { page, limit } = paginationOptions;
    const skip = (page - 1) * limit;
    console.log(skip, limit);
    const count = await this.wabaMessageModel.countDocuments(query);
    const wabaMessages = await this.wabaMessageModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).exec();
    return {
      wabaMessages,
      total: count,
      totalPages: Math.ceil(count / limit),
      page,
      limit,
    };


  }


  async findAll(
    projectId?: string,
    adminId?: string,
    campaignId?: string,
    contactId?: string,
    messageType?: string,
  ): Promise<WabaMessage[]> {
    const filter: any = { isDeleted: false };

    if (projectId) {
      filter.projectId = new Types.ObjectId(projectId);
    }

    if (adminId) {
      filter.adminId = new Types.ObjectId(adminId);
    }

    if (campaignId) {
      filter.campaignId = new Types.ObjectId(campaignId);
    } else if (messageType === 'individual') {
      filter.campaignId = { $exists: false };
    }

    if (contactId) {
      filter.contactId = new Types.ObjectId(contactId);
    }

    if (messageType) {
      filter.messageType = messageType;
    }

    return this.wabaMessageModel
      .find(filter)
      .sort({ createdAt: -1 })
      .exec();
  }

  async findOne(id: string): Promise<WabaMessage> {
    const wabaMessage = await this.wabaMessageModel
      .findOne({
        _id: new Types.ObjectId(id),
        isDeleted: false,
      })
      .populate('projectId', 'projectName phone')
      .populate('adminId', 'userName email')
      .populate('campaignId', 'name status')
      .populate('contactId', 'firstName lastName phone email')
      .exec();

    if (!wabaMessage) {
      throw new NotFoundException('WABA message not found');
    }

    return wabaMessage;
  }

  async findByWabaMessageId(wabaMessageId: string): Promise<WabaMessage | null> {
    const wabaMessage = await this.wabaMessageModel
      .findOne({
        wabaMessageId,
        isDeleted: false,
      })
      .exec();

    return wabaMessage;
  }

  async updateStatus(
    wabaMessageId: string,
    status: string,
    failureReason?: string,
  ): Promise<WabaMessage> {
    const updateData: any = { status };
    console.log(wabaMessageId, status, failureReason);

    // Set timestamp fields based on status
    const now = new Date();
    switch (status) {
      case 'sent':
        updateData.sentAt = now;
        break;
      case 'delivered':
        updateData.deliveredAt = now;
        break;
      case 'read':
        updateData.readAt = now;
        break;
      case 'failed':
        if (failureReason) {
          updateData.failureReason = failureReason;
        }
        break;
    }

    const wabaMessage = await this.wabaMessageModel
      .findOneAndUpdate({ wabaMessageId, isDeleted: false }, updateData, {
        new: true,
      })
      .exec();

    if (!wabaMessage) {
      throw new NotFoundException('WABA message not found');
    }

    return wabaMessage;
  }

  async getCampaignMessages(campaignId: string): Promise<WabaMessage[]> {
    return this.wabaMessageModel
      .find({
        campaignId: new Types.ObjectId(campaignId),
        isDeleted: false,
      })
      .sort({ createdAt: -1 })
      .exec();
  }

  async getMessageStats(campaignId: string): Promise<any> {
    const stats = await this.wabaMessageModel.aggregate([
      {
        $match: {
          campaignId: new Types.ObjectId(campaignId),
          isDeleted: false,
        },
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]);

    const result = {
      total: 0,
      pending: 0,
      sent: 0,
      delivered: 0,
      read: 0,
      clicked: 0,
      failed: 0,
    };

    stats.forEach((stat) => {
      result.total += stat.count;
      result[stat._id] = stat.count;
    });

    return result;
  }

  async remove(id: string): Promise<void> {
    const result = await this.wabaMessageModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          isDeleted: false,
        },
        { isDeleted: true },
      )
      .exec();

    if (!result) {
      throw new NotFoundException('WABA message not found');
    }
  }

  async bulkCreate(
    messages: Array<{
      campaignId?: string;
      contactId: string;
      wabaMessageId: string;
      messageType?: string;
      templateName: string;
    }>,
    projectId: string,
    adminId: string,
  ): Promise<WabaMessage[]> {
    const formattedMessages = messages.map((msg) => ({
      ...msg,
      projectId: new Types.ObjectId(`${projectId}`),
      adminId: new Types.ObjectId(`${adminId}`),
      campaignId: msg.campaignId ? new Types.ObjectId(`${msg.campaignId}`) : undefined,
      contactId: new Types.ObjectId(`${msg.contactId}`),
      messageType: msg.messageType || 'individual',
    }));

    return this.wabaMessageModel.insertMany(formattedMessages);
  }

  async getFailedMessages(campaignId?: string): Promise<WabaMessage[]> {
    const filter: any = {
      status: 'failed',
      isDeleted: false,
    };

    if (campaignId) {
      filter.campaignId = new Types.ObjectId(campaignId);
    }

    return this.wabaMessageModel
      .find(filter)
      .sort({ createdAt: -1 })
      .exec();
  }
}
