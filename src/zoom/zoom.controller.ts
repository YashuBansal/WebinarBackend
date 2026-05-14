import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Delete,
  Query,
  Headers,
  BadRequestException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import mongoose, { Types } from 'mongoose';
import { Id } from 'src/decorators/custom.decorator';
import { ZoomService } from './zoom.service';
import { CreateZoomProjectDto } from './dto/create-zoom-project.dto';
import { ValidateZoomConfigDto } from './dto/validate-zoom-config.dto';
import { QueryZoomProjectsDto } from './dto/query-zoom-projects.dto';
import { WebhookQueueService } from './webhook-queue.service';

@Controller('zoom')
export class ZoomController {
  private readonly logger = new Logger(ZoomController.name);
  constructor(
    private readonly zoomService: ZoomService,
    private readonly webhookQueueService: WebhookQueueService,
    private readonly configService: ConfigService,
  ) {}

  @Post('oauth/exchange')
  async exchange(
    @Body('code') code: string,
    @Body('state') state: string,
    @Body('redirectUri') redirectUri: string,
    @Id() adminId: string,
    @Body('projectId') projectId: string,
  ) {
    if (
      !code ||
      !redirectUri ||
      !mongoose.isValidObjectId(adminId) ||
      !mongoose.isValidObjectId(projectId)
    ) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid request',
        data: null,
      };
    }
    const doc = await this.zoomService.exchangeCodeAndSave(
      code,
      new Types.ObjectId(`${adminId}`),
      redirectUri,
      new Types.ObjectId(`${projectId}`),
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
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid admin',
        data: null,
      };
    }
    const items = await this.zoomService.listAccounts(
      new Types.ObjectId(`${adminId}`),
    );
    return { statusCode: HttpStatus.OK, message: 'Accounts', data: items };
  }

  @Delete('accounts/:accountId')
  async disconnect(
    @Id() adminId: string,
    @Param('accountId') accountId: string,
  ) {
    if (!mongoose.isValidObjectId(adminId) || !accountId) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid request',
        data: null,
      };
    }
    await this.zoomService.disconnectAccount(
      new Types.ObjectId(`${adminId}`),
      accountId,
    );
    return { statusCode: HttpStatus.OK, message: 'Disconnected', data: null };
  }

  @Post('oauth/refresh/:accountId')
  async refresh(@Id() adminId: string, @Param('accountId') accountId: string) {
    if (!mongoose.isValidObjectId(adminId) || !accountId) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid request',
        data: null,
      };
    }
    const res = await this.zoomService.refreshAccessToken(
      new Types.ObjectId(`${adminId}`),
      accountId,
    );
    return { statusCode: HttpStatus.OK, message: 'Refreshed', data: res };
  }

  @Get('me/:accountId')
  async me(@Id() adminId: string, @Param('accountId') accountId: string) {
    if (!mongoose.isValidObjectId(adminId) || !accountId) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid request',
        data: null,
      };
    }
    const profile = await this.zoomService.getZoomUserProfile(
      new Types.ObjectId(`${adminId}`),
      accountId,
    );
    return { statusCode: HttpStatus.OK, message: 'Profile', data: profile };
  }

  /**
   * Zoom Marketplace "Deauthorization Notification Endpoint URL".
   * Register: POST https://your-api/api/v1/zoom/deauthorize
   * Optional: set ZOOM_DEAUTHORIZATION_SECRET to match Zoom's verification token (Authorization header).
   */
  @Post('deauthorize')
  @HttpCode(HttpStatus.OK)
  async deauthorize(
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authorization?: string,
  ) {
    const secret = this.configService
      .get<string>('ZOOM_DEAUTHORIZATION_SECRET')
      ?.trim();
    if (secret) {
      const auth = authorization?.trim() ?? '';
      const ok =
        auth === secret ||
        auth === `Bearer ${secret}` ||
        auth === `bearer ${secret}`;
      if (!ok) {
        this.logger.warn('zoom/deauthorize rejected: invalid authorization');
        throw new UnauthorizedException('Invalid deauthorization request');
      }
    }
    await this.zoomService.handleAppDeauthorized(body);
    return {
      statusCode: HttpStatus.OK,
      message: 'Deauthorization processed',
      data: null,
    };
  }

  @Post('webhook-v3')
  @HttpCode(HttpStatus.OK)
  async webhookV3(@Body() body: any) {
    this.logger.log(
      ` ========================= ${body?.event} (v3) ========================= `,
    );

    // Handle validation synchronously (needs to return response)
    if (body.event === 'endpoint.url_validation') {
      return await this.zoomService.validateWebhookV3(body);
    }

    const deduplicationId = this.generateDeduplicationIdV3(body);
    this.logger.log(
      `Deduplication ID (v3):::::::::::::::::::::::: ${deduplicationId}`,
    );

    // Enqueue webhook for processing with v3 sentinel projectId (resolved later in service)
    const enqueued = await this.webhookQueueService.enqueue(
      body,
      '__v3__',
      deduplicationId,
    );

    if (!enqueued) {
      this.logger.error('Failed to enqueue webhook event - queue is full', {
        event: body?.event,
        deduplicationId,
      });
      // Still return 200 OK to prevent Zoom from retrying
    }

    return { statusCode: HttpStatus.OK, message: 'Webhook received' };
  }

  /**
   * Deterministic deduplication ID for webhook-v3 (no projectId query param).
   */
  private generateDeduplicationIdV3(body: any): string {
    const parts: string[] = [
      body?.event || '',
      body?.event_ts || body?.payload?.event_ts || '',
    ];

    const accountId = body?.payload?.account_id || body?.account_id || '';
    if (accountId) {
      parts.push(accountId);
    }

    const objectId = body?.payload?.object?.id || body?.object?.id || '';
    if (objectId) {
      parts.push(objectId);
    }

    const registrantId =
      body?.payload?.object?.registrant?.id ||
      body?.payload?.object?.registrant?.email ||
      body?.object?.registrant?.id ||
      body?.object?.registrant?.email ||
      '';
    if (registrantId) {
      parts.push(registrantId);
    }

    const participantId =
      body?.payload?.object?.participant?.user_id ||
      body?.payload?.object?.participant?.id ||
      body?.object?.participant?.user_id ||
      body?.object?.participant?.id ||
      '';
    if (participantId) {
      parts.push(participantId);
    }

    return parts.filter((p) => p).join('|');
  }

  @Get('webhook-v3/queue/health')
  @HttpCode(HttpStatus.OK)
  async getQueueHealth() {
    const health = this.webhookQueueService.getHealthStatus();
    const metrics = this.webhookQueueService.getMetrics();
    return {
      statusCode: HttpStatus.OK,
      health,
      metrics,
    };
  }

  // ========== CRUD APIs for Zoom Projects ==========

  @Get('projects')
  async getProjects(
    @Id() adminId: string,
    @Query() query: QueryZoomProjectsDto,
  ) {
    if (!mongoose.isValidObjectId(adminId)) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid admin',
        data: null,
      };
    }
    const result = await this.zoomService.getProjects(
      new Types.ObjectId(`${adminId}`),
      query.page || 1,
      query.limit || 10,
      query.search,
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Projects retrieved',
      data: result,
    };
  }

  @Get('projects/:id')
  async getProject(@Id() adminId: string, @Param('id') id: string) {
    if (!mongoose.isValidObjectId(adminId) || !mongoose.isValidObjectId(id)) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid request',
        data: null,
      };
    }
    const project = await this.zoomService.getProject(
      new Types.ObjectId(`${adminId}`),
      new Types.ObjectId(`${id}`),
    );
    if (!project) {
      return {
        statusCode: HttpStatus.NOT_FOUND,
        message: 'Project not found',
        data: null,
      };
    }
    return {
      statusCode: HttpStatus.OK,
      message: 'Project retrieved',
      data: project,
    };
  }

  @Post('projects')
  async createProject(
    @Id() adminId: string,
    @Body() createProjectDto: CreateZoomProjectDto,
  ) {
    if (!mongoose.isValidObjectId(adminId)) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid admin',
        data: null,
      };
    }
    const project = await this.zoomService.createProject(
      new Types.ObjectId(`${adminId}`),
      createProjectDto,
    );
    return {
      statusCode: HttpStatus.CREATED,
      message: 'Project created',
      data: project,
    };
  }

  // New: Validate credentials (S2S OAuth) and create configured project
  @Post('projects/validate-and-create')
  async validateAndCreate(
    @Id() adminId: string,
    @Body() body: ValidateZoomConfigDto,
  ) {
    if (!mongoose.isValidObjectId(adminId)) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid admin',
        data: null,
      };
    }
    const data = await this.zoomService.validateAndCreateProjectWithCredentials(
      new Types.ObjectId(`${adminId}`),
      body,
    );
    return {
      statusCode: HttpStatus.CREATED,
      message: 'Zoom project configured',
      data,
    };
  }

  @Post('projects/:id/disconnect-oauth')
  @HttpCode(HttpStatus.OK)
  async disconnectOAuth(@Id() adminId: string, @Param('id') id: string) {
    if (!mongoose.isValidObjectId(adminId) || !mongoose.isValidObjectId(id)) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid request',
        data: null,
      };
    }
    const project = await this.zoomService.disconnectOAuthProject(
      new Types.ObjectId(`${adminId}`),
      new Types.ObjectId(`${id}`),
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Zoom disconnected from project',
      data: project,
    };
  }

  @Delete('projects/:id')
  async deleteProject(@Id() adminId: string, @Param('id') id: string) {
    if (!mongoose.isValidObjectId(adminId) || !mongoose.isValidObjectId(id)) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid request',
        data: null,
      };
    }
    const deleted = await this.zoomService.deleteProject(
      new Types.ObjectId(`${adminId}`),
      new Types.ObjectId(`${id}`),
    );
    if (!deleted) {
      return {
        statusCode: HttpStatus.NOT_FOUND,
        message: 'Project not found',
        data: null,
      };
    }
    return {
      statusCode: HttpStatus.OK,
      message: 'Project deleted',
      data: { id },
    };
  }

  @Get('projects/by-account/:accountId')
  async getProjectByAccountId(
    @Id() adminId: string,
    @Param('accountId') accountId: string,
  ) {
    if (!mongoose.isValidObjectId(adminId) || !accountId) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid request',
        data: null,
      };
    }
    const project = await this.zoomService.getProjectByAccountId(
      new Types.ObjectId(`${adminId}`),
      accountId,
    );
    if (!project) {
      return {
        statusCode: HttpStatus.NOT_FOUND,
        message: 'Project not found',
        data: null,
      };
    }
    return {
      statusCode: HttpStatus.OK,
      message: 'Project retrieved',
      data: project,
    };
  }

  @Get('projects/:id/configuration-status')
  async getProjectConfigurationStatus(
    @Id() adminId: string,
    @Param('id') id: string,
  ) {
    if (!mongoose.isValidObjectId(adminId) || !mongoose.isValidObjectId(id)) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid request',
        data: null,
      };
    }
    const status = await this.zoomService.getProjectConfigurationStatus(
      new Types.ObjectId(`${adminId}`),
      new Types.ObjectId(`${id}`),
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Configuration status retrieved',
      data: status,
    };
  }

  @Get('projects/:id/webhook-subscription-status')
  async getWebhookSubscriptionStatus(
    @Id() adminId: string,
    @Param('id') id: string,
  ) {
    if (!mongoose.isValidObjectId(adminId) || !mongoose.isValidObjectId(id)) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid request',
        data: null,
      };
    }
    const status = await this.zoomService.checkWebhookSubscriptionStatus(
      new Types.ObjectId(`${adminId}`),
      new Types.ObjectId(`${id}`),
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Webhook subscription status retrieved',
      data: status,
    };
  }

  @Get('projects/:id/meetings')
  async getProjectMeetings(
    @Id() adminId: string,
    @Param('id') id: string,
    @Query('type')
    type: 'scheduled' | 'upcoming' | 'live' | 'past' | 'pending' = 'upcoming',
    @Query('pageSize') pageSize?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!mongoose.isValidObjectId(adminId) || !mongoose.isValidObjectId(id)) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid request',
        data: null,
      };
    }
    const result = await this.zoomService.getProjectMeetings(
      new Types.ObjectId(`${adminId}`),
      new Types.ObjectId(`${id}`),
      type,
      { pageSize: pageSize ? Number(pageSize) : 30, from, to },
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Meetings retrieved',
      data: result,
    };
  }

  @Get('projects/:id/webinars')
  async getProjectWebinars(
    @Id() adminId: string,
    @Param('id') id: string,
    @Query('type') type: 'upcoming' = 'upcoming',
    @Query('pageSize') pageSize?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!mongoose.isValidObjectId(adminId) || !mongoose.isValidObjectId(id)) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid request',
        data: null,
      };
    }
    const result = await this.zoomService.getProjectWebinars(
      new Types.ObjectId(`${adminId}`),
      new Types.ObjectId(`${id}`),
      type,
      { pageSize: pageSize ? Number(pageSize) : 30, from, to },
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Webinars retrieved',
      data: result,
    };
  }

  @Get('projects/:id/webinars/:webinarId')
  async getWebinarDetails(
    @Id() adminId: string,
    @Param('id') id: string,
    @Param('webinarId') webinarId: string,
  ) {
    if (
      !mongoose.isValidObjectId(adminId) ||
      !mongoose.isValidObjectId(id) ||
      !webinarId
    ) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid request',
        data: null,
      };
    }
    const result = await this.zoomService.getWebinarDetails(
      new Types.ObjectId(`${adminId}`),
      new Types.ObjectId(`${id}`),
      webinarId,
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Webinar details retrieved',
      data: result,
    };
  }

  @Get('projects/:id/webinars/:webinarId/registrants')
  async getWebinarRegistrants(
    @Id() adminId: string,
    @Param('id') id: string,
    @Param('webinarId') webinarId: string,
    @Query('status') status?: 'pending' | 'approved' | 'denied',
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
    @Query('occurrenceId') occurrenceId?: string,
  ) {
    if (
      !mongoose.isValidObjectId(adminId) ||
      !mongoose.isValidObjectId(id) ||
      !webinarId
    ) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid request',
        data: null,
      };
    }
    const pageNum = page ? parseInt(page, 10) : 1;
    const pageSizeNum = pageSize ? parseInt(pageSize, 10) : 30;
    const result = await this.zoomService.getWebinarRegistrants(
      new Types.ObjectId(`${adminId}`),
      new Types.ObjectId(`${id}`),
      webinarId,
      status ?? 'approved',
      pageNum,
      pageSizeNum,
      occurrenceId,
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Webinar registrants retrieved',
      data: result,
    };
  }

  @Get('projects/:id/meetings/:meetingId')
  async getMeetingDetails(
    @Id() adminId: string,
    @Param('id') id: string,
    @Param('meetingId') meetingId: string,
  ) {
    if (
      !mongoose.isValidObjectId(adminId) ||
      !mongoose.isValidObjectId(id) ||
      !meetingId
    ) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid request',
        data: null,
      };
    }
    const result = await this.zoomService.getMeetingDetails(
      new Types.ObjectId(`${adminId}`),
      new Types.ObjectId(`${id}`),
      meetingId,
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Meeting details retrieved',
      data: result,
    };
  }

  @Get('projects/:id/meetings/:meetingId/registrants')
  async getMeetingRegistrants(
    @Id() adminId: string,
    @Param('id') id: string,
    @Param('meetingId') meetingId: string,
    @Query('status') status?: 'pending' | 'approved' | 'denied',
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
    @Query('occurrenceId') occurrenceId?: string,
  ) {
    if (
      !mongoose.isValidObjectId(adminId) ||
      !mongoose.isValidObjectId(id) ||
      !meetingId
    ) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid request',
        data: null,
      };
    }
    const pageNum = page ? parseInt(page, 10) : 1;
    const pageSizeNum = pageSize ? parseInt(pageSize, 10) : 30;
    const result = await this.zoomService.getMeetingRegistrants(
      new Types.ObjectId(`${adminId}`),
      new Types.ObjectId(`${id}`),
      meetingId,
      false,
      pageNum,
      pageSizeNum,
      status ?? 'approved',
      occurrenceId,
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Meeting registrants retrieved',
      data: result,
    };
  }
}
