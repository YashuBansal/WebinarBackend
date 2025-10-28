import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { Id } from 'src/decorators/custom.decorator';
import { WabaMessageService } from './waba-message.service';
import { FindPaginatedWabaMessageDto } from './dto/find-paginated-waba-message.dto';
import mongoose from 'mongoose';

@Controller('waba-message')
export class WabaMessageController {
  constructor(private readonly wabaMessageService: WabaMessageService) {}

  @Get('paginated')
  async findPaginatedAll(
    @Id() adminId: string,
    @Query() queryDto: FindPaginatedWabaMessageDto,
  ) {
    const { page, limit, projectId, campaignId, contactId, messageType, templateName, meetingId } = queryDto;

    const query: any = {
      adminId: new Types.ObjectId(adminId),
    };

    if (mongoose.Types.ObjectId.isValid(projectId)) query.projectId = new Types.ObjectId(projectId);
    if (mongoose.Types.ObjectId.isValid(campaignId)) query.campaignId = new Types.ObjectId(campaignId);
    if (mongoose.Types.ObjectId.isValid(contactId)) query.contactId = new Types.ObjectId(contactId);
    if (messageType) query.messageType = messageType;
    if (templateName) query.templateName = templateName;
    if (meetingId) query.meetingId = meetingId;

    return this.wabaMessageService.findPaginatedAll(query, { page, limit });
  }

  @Get('unique-phone-numbers')
  async getUniquePhoneNumbers(
    @Id() adminId: string,
    @Query('projectId') projectId: string,
  ) {
    if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) {
      throw new BadRequestException('Valid projectId is required');
    }

    const phoneNumbers = await this.wabaMessageService.getUniquePhoneNumbers(
      adminId,
      projectId,
    );

    return {
      phoneNumbers,
      count: phoneNumbers.length,
    };
  }

  @Get('eligible-session-contacts')
  async getEligibleSessionMessageContacts(
    @Id() adminId: string,
    @Query('projectId') projectId: string,
  ) {
    if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) {
      throw new BadRequestException('Valid projectId is required');
    }

    const eligibleContacts =
      await this.wabaMessageService.getEligibleSessionMessageContacts(
        adminId,
        projectId,
      );

    return {
      eligibleContacts,
      count: eligibleContacts.length,
    };
  }
}
