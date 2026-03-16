import { Controller, Get, Query } from '@nestjs/common';
import { AppService } from './app.service';
import fetch from 'node-fetch';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('fb/interest-search')
  async proxyInterestSearch(
    @Query('accountId') accountId: string,
    @Query('accessToken') accessToken: string,
    @Query('q') q: string,
  ): Promise<any> {
    if (!accountId || !accessToken || !q) {
      return {
        error: { message: 'accountId, accessToken and q are required' },
      };
    }

    const url = `https://graph.facebook.com/v17.0/act_${encodeURIComponent(
      accountId.trim(),
    )}/targetingsearch?type=adinterest&q=${encodeURIComponent(
      q.trim(),
    )}&access_token=${encodeURIComponent(accessToken.trim())}`;

    const response = await fetch(url);
    const json = await response.json();
    return json;
  }
}
