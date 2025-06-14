import { Controller, Get, Query } from '@nestjs/common';
import { Id, Role } from 'src/decorators/custom.decorator';
import { BillingHistoryService } from './billing-history.service';
import { GetBillingHistoryDto } from './dto/bililngHistory.dto';
import { ConfigService } from '@nestjs/config';

@Controller('billing-history')
export class BillingHistoryController {
  constructor(
    private readonly billingHistoryService: BillingHistoryService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  async getBillingHistory(
    @Id() adminId: string,
    @Role() role: string,
    @Query() query: GetBillingHistoryDto,
  ) {
    const page = Number(query.page) ? Number(query.page) : 1;
    const limit = Number(query.limit) ? Number(query.limit) : 10;

    return await this.billingHistoryService.getBillingHistory({
      ...query,
      adminId:
        role === this.configService.get('appRoles')['ADMIN']
          ? adminId
          : undefined,
    });
  }
}
