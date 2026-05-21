import { Controller, Get, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AffiliateService } from './affiliate.service';
import { SaveBankDetailsDto } from './dto/bank-details.dto';
import { Id } from 'src/decorators/custom.decorator';

@Controller('affiliate')
export class AffiliateController {
  constructor(private readonly affiliateService: AffiliateService) {}

  @Get('stats')
  async getStats(@Id() userId: string) {
    const data = await this.affiliateService.getStats(userId);
    return {
      statusCode: HttpStatus.OK,
      message: 'Affiliate statistics retrieved successfully',
      data,
    };
  }

  @Get('referrals')
  async getReferrals(@Id() userId: string) {
    const referrals = await this.affiliateService.getReferrals(userId);
    return {
      statusCode: HttpStatus.OK,
      message: 'Affiliate referrals retrieved successfully',
      data: referrals,
    };
  }

  @Get('payouts')
  async getPayouts(@Id() userId: string) {
    const payouts = await this.affiliateService.getPayouts(userId);
    return {
      statusCode: HttpStatus.OK,
      message: 'Affiliate payouts retrieved successfully',
      data: payouts,
    };
  }

  @Post('payouts/request')
  @HttpCode(HttpStatus.OK)
  async requestPayout(@Id() userId: string) {
    const result = await this.affiliateService.requestPayout(userId);
    return {
      statusCode: HttpStatus.OK,
      message: result.message,
      data: result,
    };
  }

  @Get('bank-details')
  async getBankDetails(@Id() userId: string) {
    const bankDetails = await this.affiliateService.getBankDetails(userId);
    return {
      statusCode: HttpStatus.OK,
      message: 'Affiliate bank details retrieved successfully',
      data: bankDetails,
    };
  }

  @Post('bank-details')
  async saveBankDetails(@Id() userId: string, @Body() dto: SaveBankDetailsDto) {
    const result = await this.affiliateService.saveBankDetails(userId, dto);
    return {
      statusCode: HttpStatus.OK,
      message: result.message,
      data: result.bankDetails,
    };
  }
}
