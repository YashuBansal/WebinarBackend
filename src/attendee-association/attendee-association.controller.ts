import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { AttendeeAssociationService } from './attendee-association.service';
import {
  AttendeeAssociationDto,
  UpdateAttendeeTagDto,
} from './dto/attendee-association.dto';
import { AdminId } from 'src/decorators/custom.decorator';
import { Types } from 'mongoose';

@Controller('attendee-association')
export class AttendeeAssociationController {
  constructor(
    private readonly attendeeAssociationService: AttendeeAssociationService,
  ) {}

  @Post()
  async createLeadTypeAssociation(
    @Body() body: AttendeeAssociationDto,
    @AdminId() adminId: Types.ObjectId,
  ) {
    if (!adminId) {
      throw new BadRequestException('AdminID is required.');
    }
    const association = await this.attendeeAssociationService.createAssociation(
      body.email,
      adminId,
      body.leadType,
      body.leadTypeLabel,
      body.createdBy,
    );
    return association;
  }

  @Get(':email')
  async getAssociationByEmail(
    @Param('email') email: string,
    @AdminId() adminId: Types.ObjectId,
  ) {
    if (!email || !email.trim()) {
      throw new BadRequestException('Email is required.');
    }
    const association = await this.attendeeAssociationService.getAssociation(
      adminId,
      email,
    );
    return association;
  }

  @Patch(':email/tags')
  async updateAttendeeAssociationTag(
    @Param('email') email: string,
    @Body() body: UpdateAttendeeTagDto,
    @AdminId() adminId: Types.ObjectId,
  ) {
    if (!email || !email.trim()) {
      throw new BadRequestException('Email is required.');
    }
    if (!adminId) {
      throw new BadRequestException('AdminID is required.');
    }
    const association =
      await this.attendeeAssociationService.updateAttendeeAssociationTag(
        email,
        adminId,
        body.tag,
        body.action,
      );
    return {
      success: true,
      message: `Tag ${body.action === 'add' ? 'added' : 'removed'} successfully`,
      data: association,
    };
  }
}
