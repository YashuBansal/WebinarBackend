import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model, Types } from 'mongoose';
import {
  WabaMessage,
  WabaMessageDocument,
  WabaMessageType,
} from './waba-message.schema';

@Injectable()
export class WabaMessageService {
  private readonly logger = new Logger(WabaMessageService.name);
  constructor(
    @InjectModel(WabaMessage.name)
    private wabaMessageModel: Model<WabaMessageDocument>,
  ) {}

  async create(wabaMessageData: {
    projectId: string;
    adminId: string;
    phoneNumber: string;
    campaignId?: string;
    contactId?: string;
    apiCampaignId?: string;
    attendeeId?: string;
    wabaMessageId: string;
    messageType?: string;
    templateName: string;
    failureReason?: any;
    status?: string;
    meetingId?: string;
    direction?: 'inbound' | 'outbound';
    messageFormat?: 'text' | 'template' | 'media';
    templateComponents?: any[];
    templateLanguage?: string;
    textBody?: string;
    displayText?: string;
    occurrenceId?: string;
  }): Promise<WabaMessage> {
    this.logger.log(
      'wabaMessageData ------------------------- > ',
      wabaMessageData,
    );
    const wabaMessage = new this.wabaMessageModel({
      ...wabaMessageData,
      projectId: new Types.ObjectId(wabaMessageData.projectId),
      phoneNumber: wabaMessageData.phoneNumber.replace('+', ''), // remove + from phone number
      adminId: new Types.ObjectId(wabaMessageData.adminId),
      campaignId: mongoose.isValidObjectId(wabaMessageData.campaignId)
        ? new Types.ObjectId(wabaMessageData.campaignId)
        : undefined,
      contactId: mongoose.isValidObjectId(wabaMessageData.contactId)
        ? new Types.ObjectId(wabaMessageData.contactId)
        : undefined,
      apiCampaignId: mongoose.isValidObjectId(wabaMessageData.apiCampaignId)
        ? new Types.ObjectId(wabaMessageData.apiCampaignId)
        : undefined,
      attendeeId: mongoose.isValidObjectId(wabaMessageData.attendeeId)
        ? new Types.ObjectId(wabaMessageData.attendeeId)
        : undefined,
      messageType: wabaMessageData.messageType || 'individual',
      meetingId: wabaMessageData.meetingId || undefined,
      failureReason:
        typeof wabaMessageData.failureReason === 'string'
          ? wabaMessageData.failureReason
          : typeof wabaMessageData?.failureReason?.message === 'string'
            ? wabaMessageData.failureReason.message
            : undefined,
    });
    try {
      await wabaMessage.save();
      return wabaMessage;
    } catch (error) {
      this.logger.error('Error saving waba message', error);
      console.log('error ------------------------- > ', error);
      throw new InternalServerErrorException('Error saving waba message');
    }
  }

  async findPaginatedAll(
    query: {
      projectId?: Types.ObjectId;
      adminId?: Types.ObjectId;
      campaignId?: Types.ObjectId;
      apiCampaignId?: Types.ObjectId;
      contactId?: Types.ObjectId;
      messageType?: WabaMessageType;
      templateName?: string;
      meetingId?: string;
      occurrenceId?: string;
    },
    paginationOptions: {
      page: number;
      limit: number;
    },
  ) {
    const { page, limit } = paginationOptions;
    const skip = (page - 1) * limit;
    console.log('query', query);

    const count = await this.wabaMessageModel.countDocuments(query);
    const wabaMessages = await this.wabaMessageModel
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .exec();
    return {
      wabaMessages,
      total: count,
      totalPages: Math.ceil(count / limit),
      page,
      limit,
    };
  }

  async findAllRange(query: any) {
    console.log(query);
    return this.wabaMessageModel.find(query).sort({ createdAt: -1 }).exec();
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

    return this.wabaMessageModel.find(filter).sort({ createdAt: -1 }).exec();
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

  async findByWabaMessageId(
    wabaMessageId: string,
  ): Promise<WabaMessage | null> {
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

  async getCampaignMessages(campaignId: string): Promise<any[]> {
    return this.wabaMessageModel
      .find({
        campaignId: new Types.ObjectId(campaignId),
        isDeleted: false,
      })
      .sort({ createdAt: -1 })
      .exec();
  }

  async getApiCampaignMessages(apiCampaignId: string): Promise<any[]> {
    return this.wabaMessageModel
      .find({
        apiCampaignId: new Types.ObjectId(apiCampaignId),
        isDeleted: false,
      })
      .sort({ createdAt: -1 })
      .exec();
  }

  async getMessageStats({
    campaignId,
    apiCampaignId,
  }: {
    campaignId?: Types.ObjectId;
    apiCampaignId?: Types.ObjectId;
  }): Promise<any> {
    const filter: any = { isDeleted: false };
    if (mongoose.isValidObjectId(campaignId)) {
      filter.campaignId = campaignId;
    }
    if (mongoose.isValidObjectId(apiCampaignId)) {
      filter.apiCampaignId = apiCampaignId;
    }
    const result = await this.wabaMessageModel.aggregate([
      {
        $match: filter
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          pending: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] },
          },
          sent: {
            $sum: { $cond: ['$sentAt', 1, 0] },
          },
          delivered: {
            $sum: { $cond: ['$deliveredAt', 1, 0] },
          },
          read: {
            $sum: { $cond: ['$readAt', 1, 0] },
          },
          clicked: {
            $sum: { $cond: [{ $eq: ['$status', 'clicked'] }, 1, 0] },
          },
          failed: {
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] },
          },
        },
      },
      {
        $project: {
          _id: 0,
        },
      },
    ]);

    // Handle the case where no documents match the campaignId
    if (result.length > 0) {
      return result[0];
    } else {
      return {
        total: 0,
        pending: 0,
        sent: 0,
        delivered: 0,
        read: 0,
        clicked: 0,
        failed: 0,
      };
    }
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

  async getFailedMessages(campaignId?: string): Promise<WabaMessage[]> {
    const filter: any = {
      status: 'failed',
      isDeleted: false,
    };

    if (campaignId) {
      filter.campaignId = new Types.ObjectId(campaignId);
    }

    return this.wabaMessageModel.find(filter).sort({ createdAt: -1 }).exec();
  }

  async getUniquePhoneNumbers(
    adminId: string,
    projectId: string,
  ): Promise<string[]> {
    return this.wabaMessageModel.distinct('phoneNumber', {
      adminId: new Types.ObjectId(adminId),
      projectId: new Types.ObjectId(projectId),
      isDeleted: false,
    });
  }

  async getEligibleSessionMessageContacts(
    adminId: string,
    projectId: string,
  ): Promise<
    Array<{
      phoneNumber: string;
      contactId?: string;
      lastInboundMessageAt: string;
      windowExpiresAt: string;
      timeRemaining: number;
    }>
  > {
    // Calculate timestamp for 23 hours ago
    const twentyFourHoursAgo = new Date(Date.now() - 23 * 60 * 60 * 1000);

    const result = await this.wabaMessageModel.aggregate([
      {
        $match: {
          adminId: new Types.ObjectId(adminId),
          projectId: new Types.ObjectId(projectId),
          direction: 'inbound',
          isDeleted: false,
          createdAt: { $gte: twentyFourHoursAgo },
        },
      },
      {
        $sort: { createdAt: -1 },
      },
      {
        $group: {
          _id: '$phoneNumber',
          lastInboundMessageAt: { $first: '$createdAt' },
          contactId: { $first: '$contactId' },
          phoneNumber: { $first: '$phoneNumber' },
        },
      },
      {
        $project: {
          _id: 0,
          phoneNumber: 1,
          contactId: 1,
          lastInboundMessageAt: 1,
        },
      },
    ]);

    // Calculate window expiry and time remaining for each contact
    const now = new Date();
    return result.map((contact) => {
      const lastMessageDate = new Date(contact.lastInboundMessageAt);
      const windowExpiresAt = new Date(
        lastMessageDate.getTime() + 24 * 60 * 60 * 1000,
      );
      const timeRemaining = windowExpiresAt.getTime() - now.getTime();

      return {
        phoneNumber: contact.phoneNumber,
        contactId: contact.contactId?.toString(),
        lastInboundMessageAt: contact.lastInboundMessageAt.toISOString(),
        windowExpiresAt: windowExpiresAt.toISOString(),
        timeRemaining: Math.max(0, timeRemaining), // Ensure non-negative
      };
    });
  }

  async getAnalyticsSummary(options: {
    adminId?: string;
    startDate?: string;
    endDate?: string;
    projectId?: string;
  }): Promise<{
    totalMessages: number;
    pending: number;
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    dateRange: { start: string; end: string };
  }> {
    const { adminId, startDate, endDate, projectId } = options;

    const baseMatch: any = {
      isDeleted: false,
    };

    if (adminId && mongoose.Types.ObjectId.isValid(adminId)) {
      baseMatch.adminId = new Types.ObjectId(adminId);
    }

    if (projectId && mongoose.Types.ObjectId.isValid(projectId)) {
      baseMatch.projectId = new Types.ObjectId(projectId);
    }

    let rangeStart: Date;
    let rangeEnd: Date;

    if (startDate && endDate) {
      // Treat startDate and endDate as inclusive day boundaries
      const start = new Date(startDate);
      const end = new Date(endDate);

      // start at beginning of start day
      rangeStart = new Date(start);
      rangeStart.setHours(0, 0, 0, 0);

      // end is exclusive: start of the day AFTER endDate
      const endDay = new Date(end);
      endDay.setHours(0, 0, 0, 0);
      endDay.setDate(endDay.getDate() + 1);
      rangeEnd = endDay;
    } else {
      // No date filter: all-time until now
      rangeStart = new Date(0);
      rangeEnd = new Date();
    }

    const matchStage: any = {
      ...baseMatch,
    };

    // Only apply createdAt filter if a specific range is provided
    if (startDate && endDate) {
      matchStage.createdAt = { $gte: rangeStart, $lt: rangeEnd };
    }

    const result = await this.wabaMessageModel.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalMessages: { $sum: 1 },
          pending: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] },
          },
          sent: {
            $sum: { $cond: ['$sentAt', 1, 0] },
          },
          delivered: {
            $sum: { $cond: ['$deliveredAt', 1, 0] },
          },
          read: {
            $sum: { $cond: ['$readAt', 1, 0] },
          },
          failed: {
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] },
          },
        },
      },
    ]);

    const summary =
      result && result.length > 0
        ? result[0]
        : {
            totalMessages: 0,
            pending: 0,
            sent: 0,
            delivered: 0,
            read: 0,
            failed: 0,
          };

    return {
      totalMessages: summary.totalMessages,
      pending: summary.pending,
      sent: summary.sent,
      delivered: summary.delivered,
      read: summary.read,
      failed: summary.failed,
      dateRange: {
        start: rangeStart.toISOString(),
        end: rangeEnd.toISOString(),
      },
    };
  }
}
