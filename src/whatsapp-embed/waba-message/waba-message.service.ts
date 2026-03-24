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
  WabaMessageDirection,
} from './waba-message.schema';
import {
  ChatReadStatus,
  ChatReadStatusDocument,
} from './chat-read-status.schema';

@Injectable()
export class WabaMessageService {
  private readonly logger = new Logger(WabaMessageService.name);
  constructor(
    @InjectModel(WabaMessage.name)
    private wabaMessageModel: Model<WabaMessageDocument>,
    @InjectModel(ChatReadStatus.name)
    private chatReadStatusModel: Model<ChatReadStatusDocument>,
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
    messageType: string;
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
    programId?: string;
    programAssignmentId?: string;
    programSlotId?: string;
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
      programId: mongoose.isValidObjectId(wabaMessageData.programId)
        ? new Types.ObjectId(wabaMessageData.programId)
        : undefined,
      programAssignmentId: mongoose.isValidObjectId(wabaMessageData.programAssignmentId)
        ? new Types.ObjectId(wabaMessageData.programAssignmentId)
        : undefined,
      programSlotId: mongoose.isValidObjectId(wabaMessageData.programSlotId)
        ? new Types.ObjectId(wabaMessageData.programSlotId)
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
        $match: filter,
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
  ): Promise<
    Array<{
      phoneNumber: string;
      lastMessagePreview?: string;
      lastMessageAt?: string;
      unreadCount: number;
      lastMessageDirection?: 'inbound' | 'outbound';
    }>
  > {
    const adminObjectId = new Types.ObjectId(adminId);
    const projectObjectId = new Types.ObjectId(projectId);

    // Get all unique phone numbers
    const phoneNumbers = await this.wabaMessageModel.distinct('phoneNumber', {
      adminId: adminObjectId,
      projectId: projectObjectId,
      isDeleted: false,
    });

    // Get last read timestamps for all contacts
    const readStatuses = await this.chatReadStatusModel.find({
      adminId: adminObjectId,
      projectId: projectObjectId,
      phoneNumber: { $in: phoneNumbers },
    });

    const readStatusMap = new Map<string, Date>();
    readStatuses.forEach((status) => {
      readStatusMap.set(status.phoneNumber, status.lastReadAt);
    });

    // Get last message for each phone number with aggregation
    const lastMessages = await this.wabaMessageModel.aggregate([
      {
        $match: {
          adminId: adminObjectId,
          projectId: projectObjectId,
          isDeleted: false,
        },
      },
      {
        $sort: { createdAt: -1 },
      },
      {
        $group: {
          _id: '$phoneNumber',
          lastMessage: { $first: '$$ROOT' },
        },
      },
    ]);

    // Create a map for quick lookup
    const lastMessageMap = new Map();
    lastMessages.forEach((item) => {
      lastMessageMap.set(item._id, item.lastMessage);
    });

    // Calculate unread counts for all contacts in one aggregation
    const unreadCountsPipeline: any[] = [
      {
        $match: {
          adminId: adminObjectId,
          projectId: projectObjectId,
          direction: 'inbound',
          isDeleted: false,
        },
      },
      {
        $group: {
          _id: '$phoneNumber',
          messages: { $push: { createdAt: '$createdAt' } },
        },
      },
    ];

    const unreadCountsResult = await this.wabaMessageModel.aggregate(
      unreadCountsPipeline,
    );

    const unreadCountMap = new Map<string, number>();
    unreadCountsResult.forEach((item) => {
      const phoneNumber = item._id;
      const lastReadAt = readStatusMap.get(phoneNumber);
      if (lastReadAt) {
        // Count messages after lastReadAt
        const count = item.messages.filter(
          (msg: { createdAt: Date }) => msg.createdAt > lastReadAt,
        ).length;
        unreadCountMap.set(phoneNumber, count);
      } else {
        // If no read status, count all inbound messages
        unreadCountMap.set(phoneNumber, item.messages.length);
      }
    });

    // Build result array
    const result = phoneNumbers.map((phoneNumber) => {
      const lastMessage = lastMessageMap.get(phoneNumber);
      const lastReadAt = readStatusMap.get(phoneNumber);

      // Get unread count
      const unreadCount = unreadCountMap.get(phoneNumber) || 0;

      // Get last message preview
      let lastMessagePreview: string | undefined;
      let lastMessageAt: string | undefined;
      let lastMessageDirection: 'inbound' | 'outbound' | undefined;

      if (lastMessage) {
        lastMessageAt = lastMessage.createdAt.toISOString();
        lastMessageDirection = lastMessage.direction;

        if (lastMessage.messageFormat === 'media') {
          if (lastMessage.mimeType?.startsWith('image/')) {
            lastMessagePreview = 'Image';
          } else if (lastMessage.mimeType?.startsWith('video/')) {
            lastMessagePreview = 'Video';
          } else {
            lastMessagePreview = 'Media';
          }
        } else if (lastMessage.messageFormat === 'template') {
          lastMessagePreview = lastMessage.displayText || lastMessage.textBody || '[Template]';
        } else {
          lastMessagePreview = lastMessage.textBody || lastMessage.displayText;
        }

        // Truncate preview to 50 characters
        if (lastMessagePreview && lastMessagePreview.length > 50) {
          lastMessagePreview = lastMessagePreview.substring(0, 50) + '...';
        }
      }

      return {
        phoneNumber,
        lastMessagePreview,
        lastMessageAt,
        unreadCount,
        lastMessageDirection,
      };
    });

    // Sort by lastMessageAt descending (newest first)
    result.sort((a, b) => {
      if (!a.lastMessageAt && !b.lastMessageAt) return 0;
      if (!a.lastMessageAt) return 1;
      if (!b.lastMessageAt) return -1;
      return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
    });

    return result;
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
      lastMessagePreview?: string;
      lastMessageAt?: string;
      unreadCount: number;
      lastMessageDirection?: 'inbound' | 'outbound';
    }>
  > {
    const adminObjectId = new Types.ObjectId(adminId);
    const projectObjectId = new Types.ObjectId(projectId);

    // Calculate timestamp for 23 hours ago
    const twentyFourHoursAgo = new Date(Date.now() - 23 * 60 * 60 * 1000);

    const result = await this.wabaMessageModel.aggregate([
      {
        $match: {
          adminId: adminObjectId,
          projectId: projectObjectId,
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

    // Get phone numbers for eligible contacts
    const eligiblePhoneNumbers = result.map((r) => r.phoneNumber);

    // Get last read timestamps
    const readStatuses = await this.chatReadStatusModel.find({
      adminId: adminObjectId,
      projectId: projectObjectId,
      phoneNumber: { $in: eligiblePhoneNumbers },
    });

    const readStatusMap = new Map<string, Date>();
    readStatuses.forEach((status) => {
      readStatusMap.set(status.phoneNumber, status.lastReadAt);
    });

    // Get last message (any direction) for each eligible contact
    const lastMessages = await this.wabaMessageModel.aggregate([
      {
        $match: {
          adminId: adminObjectId,
          projectId: projectObjectId,
          phoneNumber: { $in: eligiblePhoneNumbers },
          isDeleted: false,
        },
      },
      {
        $sort: { createdAt: -1 },
      },
      {
        $group: {
          _id: '$phoneNumber',
          lastMessage: { $first: '$$ROOT' },
        },
      },
    ]);

    const lastMessageMap = new Map();
    lastMessages.forEach((item) => {
      lastMessageMap.set(item._id, item.lastMessage);
    });

    // Calculate unread counts
    const unreadCountsResult = await this.wabaMessageModel.aggregate([
      {
        $match: {
          adminId: adminObjectId,
          projectId: projectObjectId,
          phoneNumber: { $in: eligiblePhoneNumbers },
          direction: 'inbound',
          isDeleted: false,
        },
      },
      {
        $group: {
          _id: '$phoneNumber',
          messages: { $push: { createdAt: '$createdAt' } },
        },
      },
    ]);

    const unreadCountMap = new Map<string, number>();
    unreadCountsResult.forEach((item) => {
      const phoneNumber = item._id;
      const lastReadAt = readStatusMap.get(phoneNumber);
      if (lastReadAt) {
        const count = item.messages.filter(
          (msg: { createdAt: Date }) => msg.createdAt > lastReadAt,
        ).length;
        unreadCountMap.set(phoneNumber, count);
      } else {
        unreadCountMap.set(phoneNumber, item.messages.length);
      }
    });

    // Calculate window expiry and time remaining for each contact
    const now = new Date();
    const enrichedResult = result.map((contact) => {
      const lastMessageDate = new Date(contact.lastInboundMessageAt);
      const windowExpiresAt = new Date(
        lastMessageDate.getTime() + 24 * 60 * 60 * 1000,
      );
      const timeRemaining = windowExpiresAt.getTime() - now.getTime();

      const lastMessage = lastMessageMap.get(contact.phoneNumber);
      const lastReadAt = readStatusMap.get(contact.phoneNumber);
      const unreadCount = unreadCountMap.get(contact.phoneNumber) || 0;

      // Get last message preview
      let lastMessagePreview: string | undefined;
      let lastMessageAt: string | undefined;
      let lastMessageDirection: 'inbound' | 'outbound' | undefined;

      if (lastMessage) {
        lastMessageAt = lastMessage.createdAt.toISOString();
        lastMessageDirection = lastMessage.direction;

        if (lastMessage.messageFormat === 'media') {
          if (lastMessage.mimeType?.startsWith('image/')) {
            lastMessagePreview = 'Image';
          } else if (lastMessage.mimeType?.startsWith('video/')) {
            lastMessagePreview = 'Video';
          } else {
            lastMessagePreview = 'Media';
          }
        } else if (lastMessage.messageFormat === 'template') {
          lastMessagePreview = lastMessage.displayText || lastMessage.textBody || '[Template]';
        } else {
          lastMessagePreview = lastMessage.textBody || lastMessage.displayText;
        }

        // Truncate preview to 50 characters
        if (lastMessagePreview && lastMessagePreview.length > 50) {
          lastMessagePreview = lastMessagePreview.substring(0, 50) + '...';
        }
      }

      return {
        phoneNumber: contact.phoneNumber,
        contactId: contact.contactId?.toString(),
        lastInboundMessageAt: contact.lastInboundMessageAt.toISOString(),
        windowExpiresAt: windowExpiresAt.toISOString(),
        timeRemaining: Math.max(0, timeRemaining),
        lastMessagePreview,
        lastMessageAt,
        unreadCount,
        lastMessageDirection,
      };
    });

    // Sort by lastMessageAt descending (newest first)
    enrichedResult.sort((a, b) => {
      if (!a.lastMessageAt && !b.lastMessageAt) return 0;
      if (!a.lastMessageAt) return 1;
      if (!b.lastMessageAt) return -1;
      return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
    });

    return enrichedResult;
  }

  async markMessagesAsRead(
    adminId: string,
    projectId: string,
    phoneNumber: string,
  ): Promise<void> {
    const adminObjectId = new Types.ObjectId(adminId);
    const projectObjectId = new Types.ObjectId(projectId);

    // Upsert: update if exists, create if not
    await this.chatReadStatusModel.findOneAndUpdate(
      {
        adminId: adminObjectId,
        projectId: projectObjectId,
        phoneNumber: phoneNumber.replace('+', ''),
      },
      {
        adminId: adminObjectId,
        projectId: projectObjectId,
        phoneNumber: phoneNumber.replace('+', ''),
        lastReadAt: new Date(),
      },
      {
        upsert: true,
        new: true,
      },
    );
  }

  async getMessageCountsByAdminAndProject(
    adminId: string,
    projectId?: string,
  ): Promise<{ inbound: number; outbound: number }> {
    const match: any = {
      adminId: new Types.ObjectId(adminId),
      isDeleted: false,
    };
    if (projectId && mongoose.Types.ObjectId.isValid(projectId)) {
      match.projectId = new Types.ObjectId(projectId);
    }

    const result = await this.wabaMessageModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$direction',
          count: { $sum: 1 },
        },
      },
    ]);

    const inbound =
      result.find((r) => r._id === WabaMessageDirection.INBOUND)?.count ?? 0;
    const outbound =
      result.find((r) => r._id === WabaMessageDirection.OUTBOUND)?.count ?? 0;

    return { inbound, outbound };
  }

  async getAllMessageCountsPaginated(options: {
    startDate?: string;
    endDate?: string;
    page: number;
    limit: number;
  }): Promise<{
    data: Array<{
      adminId: string;
      projectId: string;
      companyName?: string;
      email?: string;
      phone?: string;
      projectName?: string;
      inbound: number;
      outbound: number;
    }>;
    total: number;
    totalReceived: number;
    totalSent: number;
    page: number;
    limit: number;
    totalPages: number;
    dateRange?: { start: string; end: string };
  }> {
    const { startDate, endDate, page, limit } = options;

    const baseMatch: any = { isDeleted: false };

    let rangeStart: Date;
    let rangeEnd: Date;

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      rangeStart = new Date(start);
      rangeStart.setHours(0, 0, 0, 0);
      const endDay = new Date(end);
      endDay.setHours(0, 0, 0, 0);
      endDay.setDate(endDay.getDate() + 1);
      rangeEnd = endDay;
      baseMatch.createdAt = { $gte: rangeStart, $lt: rangeEnd };
    } else if (startDate) {
      rangeStart = new Date(startDate);
      rangeStart.setHours(0, 0, 0, 0);
      rangeEnd = new Date();
      baseMatch.createdAt = { $gte: rangeStart };
    } else if (endDate) {
      rangeStart = new Date(0);
      const endDay = new Date(endDate);
      endDay.setHours(23, 59, 59, 999);
      rangeEnd = endDay;
      baseMatch.createdAt = { $lte: rangeEnd };
    } else {
      rangeStart = new Date(0);
      rangeEnd = new Date();
    }

    const skip = (page - 1) * limit;

    const countPipeline: any[] = [
      { $match: baseMatch },
      {
        $group: {
          _id: { adminId: '$adminId', projectId: '$projectId' },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id.adminId',
          foreignField: '_id',
          as: 'adminDoc',
        },
      },
      {
        $lookup: {
          from: 'projects',
          localField: '_id.projectId',
          foreignField: '_id',
          as: 'projectDoc',
        },
      },
      {
        $match: {
          $expr: {
            $and: [
              { $gt: [{ $size: '$adminDoc' }, 0] },
              { $gt: [{ $size: '$projectDoc' }, 0] },
            ],
          },
        },
      },
      { $count: 'total' },
    ];

    const dataPipeline: any[] = [
      { $match: baseMatch },
      {
        $group: {
          _id: { adminId: '$adminId', projectId: '$projectId' },
          inbound: {
            $sum: {
              $cond: [
                { $eq: ['$direction', WabaMessageDirection.INBOUND] },
                1,
                0,
              ],
            },
          },
          outbound: {
            $sum: {
              $cond: [
                { $eq: ['$direction', WabaMessageDirection.OUTBOUND] },
                1,
                0,
              ],
            },
          },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id.adminId',
          foreignField: '_id',
          as: 'adminDoc',
        },
      },
      {
        $lookup: {
          from: 'projects',
          localField: '_id.projectId',
          foreignField: '_id',
          as: 'projectDoc',
        },
      },
      {
        $match: {
          $expr: {
            $and: [
              { $gt: [{ $size: '$adminDoc' }, 0] },
              { $gt: [{ $size: '$projectDoc' }, 0] },
            ],
          },
        },
      },
      { $sort: { '_id.adminId': 1, '_id.projectId': 1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          adminId: { $toString: '$_id.adminId' },
          projectId: { $toString: '$_id.projectId' },
          companyName: { $arrayElemAt: ['$adminDoc.companyName', 0] },
          email: { $arrayElemAt: ['$adminDoc.email', 0] },
          phone: { $arrayElemAt: ['$projectDoc.phone', 0] },
          projectName: { $arrayElemAt: ['$projectDoc.projectName', 0] },
          inbound: 1,
          outbound: 1,
        },
      },
    ];

    const totalsPipeline: any[] = [
      { $match: baseMatch },
      {
        $group: {
          _id: { adminId: '$adminId', projectId: '$projectId' },
          inbound: {
            $sum: {
              $cond: [
                { $eq: ['$direction', WabaMessageDirection.INBOUND] },
                1,
                0,
              ],
            },
          },
          outbound: {
            $sum: {
              $cond: [
                { $eq: ['$direction', WabaMessageDirection.OUTBOUND] },
                1,
                0,
              ],
            },
          },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id.adminId',
          foreignField: '_id',
          as: 'adminDoc',
        },
      },
      {
        $lookup: {
          from: 'projects',
          localField: '_id.projectId',
          foreignField: '_id',
          as: 'projectDoc',
        },
      },
      {
        $match: {
          $expr: {
            $and: [
              { $gt: [{ $size: '$adminDoc' }, 0] },
              { $gt: [{ $size: '$projectDoc' }, 0] },
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          totalReceived: { $sum: '$inbound' },
          totalSent: { $sum: '$outbound' },
        },
      },
    ];

    const [countResult, dataResult, totalsResult] = await Promise.all([
      this.wabaMessageModel.aggregate(countPipeline),
      this.wabaMessageModel.aggregate(dataPipeline),
      this.wabaMessageModel.aggregate(totalsPipeline),
    ]);

    const total = countResult[0]?.total ?? 0;
    const data = dataResult ?? [];
    const totalReceived = totalsResult[0]?.totalReceived ?? 0;
    const totalSent = totalsResult[0]?.totalSent ?? 0;

    const totalPages = Math.ceil(total / limit);

    const result: {
      data: Array<{
        adminId: string;
        projectId: string;
        companyName?: string;
        email?: string;
        phone?: string;
        projectName?: string;
        inbound: number;
        outbound: number;
      }>;
      total: number;
      totalReceived: number;
      totalSent: number;
      page: number;
      limit: number;
      totalPages: number;
      dateRange?: { start: string; end: string };
    } = {
      data,
      total,
      totalReceived,
      totalSent,
      page,
      limit,
      totalPages,
    };

    if (startDate || endDate) {
      result.dateRange = {
        start: rangeStart.toISOString(),
        end: rangeEnd.toISOString(),
      };
    }

    return result;
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
