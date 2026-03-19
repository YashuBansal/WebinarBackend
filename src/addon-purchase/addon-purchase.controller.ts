import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Id } from 'src/decorators/custom.decorator';
import { AddonPurchaseService } from './addon-purchase.service';
import {
  CreateAddonPurchaseDto,
  GetAddonPurchaseQueryDto,
} from './dto/addon-purchase.dto';

@Controller('addons/purchases')
export class AddonPurchaseController {
  constructor(private readonly addonPurchaseService: AddonPurchaseService) {}

  @Post()
  async createPurchase(
    @Body() body: CreateAddonPurchaseDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Id() adminId: string,
  ) {
    return await this.addonPurchaseService.createRazorpayPurchaseOrder({
      adminId,
      addonId: body.addonId,
      idempotencyKey,
    });
  }

  @Get(':purchaseId')
  async getPurchase(
    @Param('purchaseId') purchaseId: string,
    @Query() _query: GetAddonPurchaseQueryDto,
  ) {
    return this.addonPurchaseService.getPurchaseById(purchaseId);
  }
}

