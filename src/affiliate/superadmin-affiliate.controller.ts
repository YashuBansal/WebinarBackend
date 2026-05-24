import { Controller, Get, Post, Body, Param, HttpStatus, HttpCode } from '@nestjs/common';
import { AffiliateService } from './affiliate.service';

@Controller('superadmin-affiliate')
export class SuperAdminAffiliateController {
  constructor(private readonly affiliateService: AffiliateService) {}

  @Get('profiles')
  async getAllAffiliates() {
    const data = await this.affiliateService.getAllAffiliates();
    return {
      statusCode: HttpStatus.OK,
      message: 'All affiliate profiles retrieved successfully',
      data,
    };
  }

  @Get('referrals')
  async getAllReferrals() {
    const data = await this.affiliateService.getAllReferrals();
    return {
      statusCode: HttpStatus.OK,
      message: 'All affiliate referrals retrieved successfully',
      data,
    };
  }

  @Get('payouts')
  async getAllPayouts() {
    const data = await this.affiliateService.getAllPayouts();
    return {
      statusCode: HttpStatus.OK,
      message: 'All payout requests retrieved successfully',
      data,
    };
  }

  @Post('payouts/:id/status')
  @HttpCode(HttpStatus.OK)
  async updatePayoutStatus(
    @Param('id') payoutId: string,
    @Body() body: { status: string },
  ) {
    const result = await this.affiliateService.updatePayoutStatus(payoutId, body.status);
    return {
      statusCode: HttpStatus.OK,
      message: result.message,
      data: result.payout,
    };
  }

  @Post('profiles/:id/rates')
  @HttpCode(HttpStatus.OK)
  async updateAffiliateRates(
    @Param('id') affiliateId: string,
    @Body() body: { tier1Rate: number; tier2Rate: number },
  ) {
    const result = await this.affiliateService.updateAffiliateRates(
      affiliateId,
      body.tier1Rate,
      body.tier2Rate,
    );
    return {
      statusCode: HttpStatus.OK,
      message: result.message,
      data: result.affiliate,
    };
  }
}
