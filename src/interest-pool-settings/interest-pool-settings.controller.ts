import {
  Body,
  Controller,
  Get,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { InterestPoolSettingsService } from './interest-pool-settings.service';
import { AuthTokenGuard } from 'src/guards/authToken.guard';

class UpdateInterestPoolSettingsDto {
  accountId: string;
  accessToken: string;
}

@UseGuards(AuthTokenGuard)
@Controller('interest-pool/settings')
export class InterestPoolSettingsController {
  constructor(
    private readonly interestPoolSettingsService: InterestPoolSettingsService,
  ) {}

  @Get()
  async getMySettings(@Req() req: Request) {
    const user = (req as any).user;
    const userId = user?._id || user?.id;
    if (!userId) {
      return null;
    }

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
    @Req() req: Request,
    @Body() body: UpdateInterestPoolSettingsDto,
  ) {
    const user = (req as any).user;
    const userId = user?._id || user?.id;
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

