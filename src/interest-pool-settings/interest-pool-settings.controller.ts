import { Body, Controller, Get, Put } from '@nestjs/common';
import { InterestPoolSettingsService } from './interest-pool-settings.service';
import { Id } from 'src/decorators/custom.decorator';

class UpdateInterestPoolSettingsDto {
  accountId: string;
  accessToken: string;
}

@Controller('interest-pool/settings')
export class InterestPoolSettingsController {
  constructor(
    private readonly interestPoolSettingsService: InterestPoolSettingsService,
  ) {}

  @Get()
  async getMySettings(@Id() userId: string) {
    const settings = await this.interestPoolSettingsService.getForUser(
      String(userId),
    );

    if (!settings) {
      return null;
    }

    return {
      accountId: settings.accountId,
      accessToken: settings.accessToken,
    };
  }

  @Put()
  async updateMySettings(
    @Id() userId: string,
    @Body() body: UpdateInterestPoolSettingsDto,
  ) {
    if (!userId) {
      throw new Error('Unauthorized');
    }

    const { accountId, accessToken } = body;

    if (!accountId || !accessToken) {
      throw new Error('accountId and accessToken are required');
    }

    const doc = await this.interestPoolSettingsService.upsertForUser(
      String(userId),
      { accountId, accessToken },
    );

    return {
      accountId: doc.accountId,
      accessToken: doc.accessToken,
    };
  }
}
