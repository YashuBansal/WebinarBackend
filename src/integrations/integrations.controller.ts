import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';
import { Id } from 'src/decorators/custom.decorator';

@Controller('integrations/settings')
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get()
  async getMySettings(@Id() userId: string) {
    if (!userId) {
      throw new Error('Unauthorized');
    }
    return this.integrationsService.getForUser(userId);
  }

  @Put()
  async updateMySettings(
    @Id() userId: string,
    @Body() body: any,
  ) {
    if (!userId) {
      throw new Error('Unauthorized');
    }
    return this.integrationsService.upsertForUser(userId, body);
  }

  @Post('send-data')
  async sendData(
    @Id() userId: string,
    @Body() body: {
      integrationKey: 'convertkit' | 'aweber' | 'activecampaign' | 'pabblyEmail';
      attendeeIds: string[];
      webinarId?: string;
      tag?: string;
    },
  ) {
    if (!userId) {
      throw new Error('Unauthorized');
    }
    const { integrationKey, attendeeIds, webinarId, tag } = body;
    return this.integrationsService.sendDataToIntegration(
      userId,
      integrationKey,
      attendeeIds,
      webinarId,
      tag,
    );
  }
}
