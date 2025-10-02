import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Delete } from '@nestjs/common';
import mongoose, { Types } from 'mongoose';
import { Id } from 'src/decorators/custom.decorator';
import { ZoomService } from './zoom.service';

@Controller('zoom')
export class ZoomController {
  constructor(private readonly zoomService: ZoomService) {}

  @Post('oauth/exchange')
  async exchange(
    @Body('code') code: string,
    @Body('state') state: string,
    @Body('redirectUri') redirectUri: string,
    @Id() adminId: string,
  ) {
    if (!code || !redirectUri || !mongoose.isValidObjectId(adminId)) {
      return { statusCode: HttpStatus.BAD_REQUEST, message: 'Invalid request', data: null };
    }
    const doc = await this.zoomService.exchangeCodeAndSave(
      code,
      new Types.ObjectId(`${adminId}`),
      redirectUri,
    );
    return {
      statusCode: HttpStatus.CREATED,
      message: 'Zoom connected successfully',
      data: { id: doc._id },
    };
  }

  @Get('accounts')
  async list(@Id() adminId: string) {
    if (!mongoose.isValidObjectId(adminId)) {
      return { statusCode: HttpStatus.BAD_REQUEST, message: 'Invalid admin', data: null };
    }
    const items = await this.zoomService.listAccounts(new Types.ObjectId(`${adminId}`));
    return { statusCode: HttpStatus.OK, message: 'Accounts', data: items };
  }

  @Delete('accounts/:accountId')
  async disconnect(@Id() adminId: string, @Param('accountId') accountId: string) {
    if (!mongoose.isValidObjectId(adminId) || !accountId) {
      return { statusCode: HttpStatus.BAD_REQUEST, message: 'Invalid request', data: null };
    }
    await this.zoomService.disconnectAccount(new Types.ObjectId(`${adminId}`), accountId);
    return { statusCode: HttpStatus.OK, message: 'Disconnected', data: null };
  }

  @Post('oauth/refresh/:accountId')
  async refresh(@Id() adminId: string, @Param('accountId') accountId: string) {
    if (!mongoose.isValidObjectId(adminId) || !accountId) {
      return { statusCode: HttpStatus.BAD_REQUEST, message: 'Invalid request', data: null };
    }
    const res = await this.zoomService.refreshAccessToken(new Types.ObjectId(`${adminId}`), accountId);
    return { statusCode: HttpStatus.OK, message: 'Refreshed', data: res };
  }

  @Get('me/:accountId')
  async me(@Id() adminId: string, @Param('accountId') accountId: string) {
    if (!mongoose.isValidObjectId(adminId) || !accountId) {
      return { statusCode: HttpStatus.BAD_REQUEST, message: 'Invalid request', data: null };
    }
    const profile = await this.zoomService.getZoomUserProfile(new Types.ObjectId(`${adminId}`), accountId);
    return { statusCode: HttpStatus.OK, message: 'Profile', data: profile };
  }

  @Post('webhook')
  @HttpCode(200)
  async webhook(@Body() body: any) {
    await this.zoomService.processWebhookPayload(body);
    return;
  }
}

