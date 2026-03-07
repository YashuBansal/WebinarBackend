import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import { AdminId, Id } from 'src/decorators/custom.decorator';
import { SubscriptionService } from './subscription.service';
import {
  AddAddOnDTO,
  UpdateExpiryDateDTO,
  UpdatePlanDTO,
  ValidateUserEligibilityDTO,
} from './dto/subscription.dto';
import { Types } from 'mongoose';

@Controller('subscription')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Get()
  async getSubscription(@AdminId() adminId: string) {
    return await this.subscriptionService.getSubscription(adminId);
  }

  @Get('gst-value')
  async getGSTValue() {
    return await this.subscriptionService.getGSTValue();
  }

  @Get('validate')
  async validateUserEligibility(
    @Id() adminId: string,
    @Query() query: ValidateUserEligibilityDTO,
  ) {
    return await this.subscriptionService.validateUserEligibility(
      adminId,
      query.planId,
      query.durationType,
    );
  }

  @Patch('addOn')
  async addAddonToSubscription(@Body() body: AddAddOnDTO) {
    return await this.subscriptionService.addAddonToSubscription(
      body.adminId,
      body.addonId,
    );
  }

  @Patch('update')
  async updateSubscription(@Body() body: UpdatePlanDTO) {
    return await this.subscriptionService.updateClientPlan(
      body.email,
      body.planId,
      body.durationType,
    );
  }

  @Patch('expiry-date')
  async updateSubscriptionExpiryDate(@Body() body: UpdateExpiryDateDTO) {
    const adminId = new Types.ObjectId(body.adminId);
    const expiryDate = new Date(body.expiryDate);

    return await this.subscriptionService.updateSubscriptionExpiryDate(
      adminId,
      expiryDate,
    );
  }
}
