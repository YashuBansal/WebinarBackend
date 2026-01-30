import { Controller, Get, Post, Query, Body, BadRequestException } from '@nestjs/common';
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
    const { page, limit, projectId, campaignId, contactId, messageType, templateName, meetingId, occurrenceId } = queryDto;

    const query: any = {
      adminId: new Types.ObjectId(adminId),
    };

    if (mongoose.Types.ObjectId.isValid(projectId)) query.projectId = new Types.ObjectId(projectId);
    if (mongoose.Types.ObjectId.isValid(campaignId)) query.campaignId = new Types.ObjectId(campaignId);
    if (mongoose.Types.ObjectId.isValid(contactId)) query.contactId = new Types.ObjectId(contactId);
    if (messageType) query.messageType = messageType;
    if (templateName) query.templateName = templateName;
    if (meetingId) query.meetingId = meetingId;
    if (occurrenceId) query.occurrenceId = occurrenceId;

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

    const contacts = await this.wabaMessageService.getUniquePhoneNumbers(
      adminId,
      projectId,
    );

    return {
      phoneNumbers: contacts,
      count: contacts.length,
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

  @Get('analytics')
  async getAnalyticsSummary(
    @Query('adminId') adminId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('projectId') projectId?: string,
  ) {
    const hasStart = !!startDate;
    const hasEnd = !!endDate;
    const hasRange = hasStart && hasEnd;

    if ((hasStart && !hasEnd) || (!hasStart && hasEnd)) {
      throw new BadRequestException(
        'Both "startDate" and "endDate" are required when using a date range',
      );
    }

    let parsedStartDate: Date | undefined;
    let parsedEndDate: Date | undefined;

    if (hasRange) {
      parsedStartDate = new Date(startDate as string);
      parsedEndDate = new Date(endDate as string);

      if (isNaN(parsedStartDate.getTime()) || isNaN(parsedEndDate.getTime())) {
        throw new BadRequestException('Invalid "startDate" or "endDate" format');
      }

      if (parsedStartDate > parsedEndDate) {
        throw new BadRequestException(
          '"startDate" must be before or equal to "endDate"',
        );
      }
    }

    if (projectId && !mongoose.Types.ObjectId.isValid(projectId)) {
      throw new BadRequestException('Invalid "projectId"');
    }

    if (adminId && !mongoose.Types.ObjectId.isValid(adminId)) {
      throw new BadRequestException('Invalid \"adminId\"');
    }

    return this.wabaMessageService.getAnalyticsSummary({
      adminId,
      startDate: hasRange ? parsedStartDate!.toISOString() : undefined,
      endDate: hasRange ? parsedEndDate!.toISOString() : undefined,
      projectId,
    });
  }

  @Post('mark-as-read')
  async markAsRead(
    @Id() adminId: string,
    @Body() body: { projectId: string; phoneNumber: string },
  ) {
    const { projectId, phoneNumber } = body;

    if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) {
      throw new BadRequestException('Valid projectId is required');
    }

    if (!phoneNumber || typeof phoneNumber !== 'string') {
      throw new BadRequestException('Phone number is required');
    }

    await this.wabaMessageService.markMessagesAsRead(
      adminId,
      projectId,
      phoneNumber,
    );

    return { success: true };
  }
}
