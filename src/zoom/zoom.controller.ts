import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Delete, Put, Query, Headers, BadRequestException, Logger } from '@nestjs/common';
import mongoose, { Types } from 'mongoose';
import { Id } from 'src/decorators/custom.decorator';
import { ZoomService } from './zoom.service';
import { CreateZoomProjectDto } from './dto/create-zoom-project.dto';
import { ValidateZoomConfigDto } from './dto/validate-zoom-config.dto';
import { UpdateZoomProjectDto } from './dto/update-zoom-project.dto';
import { QueryZoomProjectsDto } from './dto/query-zoom-projects.dto';
import { WebhookQueueService } from './webhook-queue.service';

@Controller('zoom')
export class ZoomController {
  private readonly logger = new Logger(ZoomController.name);
  constructor(
    private readonly zoomService: ZoomService,
    private readonly webhookQueueService: WebhookQueueService,
  ) { }

  @Post('oauth/exchange')
  async exchange(
    @Body('code') code: string,
    @Body('state') state: string,
    @Body('redirectUri') redirectUri: string,
    @Id() adminId: string,
    @Body('projectId') projectId: string,
  ) {
    if (!code || !redirectUri || !mongoose.isValidObjectId(adminId) || !mongoose.isValidObjectId(projectId)) {
      return { statusCode: HttpStatus.BAD_REQUEST, message: 'Invalid request', data: null };
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

  @Post('webhook-v2')
  @HttpCode(HttpStatus.OK)
  async webhook(@Body() body: any, @Query('projectId') projectId: string) {

    this.logger.log(` ========================= ${body?.event} ========================= `);

    // Handle validation synchronously (needs to return response)
    if (body.event === 'endpoint.url_validation') {
      if (!mongoose.isValidObjectId(projectId))
        throw new BadRequestException('Invalid projectId');
      return await this.zoomService.validateWebhook(body, new Types.ObjectId(`${projectId}`));
    }

    // Generate deduplication ID for idempotency
    const deduplicationId = this.generateDeduplicationId(body, projectId);
    this.logger.log(`Deduplication ID:::::::::::::::::::::::: ${deduplicationId}`);

    // Enqueue webhook for processing
    // Return 200 OK immediately to prevent Zoom from retrying
    const enqueued = await this.webhookQueueService.enqueue(body, projectId, deduplicationId);
    
    if (!enqueued) {
      this.logger.error('Failed to enqueue webhook event - queue is full', {
        event: body?.event,
        projectId,
        deduplicationId,
      });
      // Still return 200 OK to prevent Zoom from retrying
      // The event is lost, but we log it for monitoring
    }

    return { statusCode: HttpStatus.OK, message: 'Webhook received' };
  }

  /**
   * Generate a deterministic deduplication ID from webhook payload
   * This ensures the same event from Zoom (retries) will be identified as duplicates
   */
  private generateDeduplicationId(body: any, projectId: string): string {
    const parts: string[] = [
      projectId || '',
      body?.event || '',
      body?.event_ts || body?.payload?.event_ts || '',
    ];

    // Add entity ID (meeting/webinar ID)
    const objectId = body?.payload?.object?.id || body?.object?.id || '';
    if (objectId) {
      parts.push(objectId);
    }

    // Add registrant/participant identifier for granular uniqueness
    // This ensures different registrations are treated as separate events
    const registrantId = body?.payload?.object?.registrant?.id || 
                        body?.payload?.object?.registrant?.email ||
                        body?.object?.registrant?.id ||
                        body?.object?.registrant?.email ||
                        '';
    if (registrantId) {
      parts.push(registrantId);
    }

    const participantId = body?.payload?.object?.participant?.user_id ||
                         body?.payload?.object?.participant?.id ||
                         body?.object?.participant?.user_id ||
                         body?.object?.participant?.id ||
                         '';
    if (participantId) {
      parts.push(participantId);
    }

    // Join all parts with a delimiter and create a hash-like string
    // Using a simple concatenation since we need deterministic IDs
    return parts.filter(p => p).join('|');
  }

  @Get('webhook-v2/queue/health')
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
      return { statusCode: HttpStatus.BAD_REQUEST, message: 'Invalid admin', data: null };
    }
    const result = await this.zoomService.getProjects(
      new Types.ObjectId(`${adminId}`),
      query.page || 1,
      query.limit || 10,
      query.search,
    );
    return { statusCode: HttpStatus.OK, message: 'Projects retrieved', data: result };
  }

  @Get('projects/:id')
  async getProject(@Id() adminId: string, @Param('id') id: string) {
    if (!mongoose.isValidObjectId(adminId) || !mongoose.isValidObjectId(id)) {
      return { statusCode: HttpStatus.BAD_REQUEST, message: 'Invalid request', data: null };
    }
    const project = await this.zoomService.getProject(new Types.ObjectId(`${adminId}`), new Types.ObjectId(`${id}`));
    if (!project) {
      return { statusCode: HttpStatus.NOT_FOUND, message: 'Project not found', data: null };
    }
    return { statusCode: HttpStatus.OK, message: 'Project retrieved', data: project };
  }

  @Post('projects')
  async createProject(
    @Id() adminId: string,
    @Body() createProjectDto: CreateZoomProjectDto,
  ) {
    if (!mongoose.isValidObjectId(adminId)) {
      return { statusCode: HttpStatus.BAD_REQUEST, message: 'Invalid admin', data: null };
    }
    const project = await this.zoomService.createProject(new Types.ObjectId(`${adminId}`), createProjectDto);
    return { statusCode: HttpStatus.CREATED, message: 'Project created', data: project };
  }

  // New: Validate credentials (S2S OAuth) and create configured project
  @Post('projects/validate-and-create')
  async validateAndCreate(
    @Id() adminId: string,
    @Body() body: ValidateZoomConfigDto,
  ) {
    if (!mongoose.isValidObjectId(adminId)) {
      return { statusCode: HttpStatus.BAD_REQUEST, message: 'Invalid admin', data: null };
    }
    const data = await this.zoomService.validateAndCreateProjectWithCredentials(
      new Types.ObjectId(`${adminId}`),
      body,
    );
    return { statusCode: HttpStatus.CREATED, message: 'Zoom project configured', data };
  }

  @Put('projects/:id')
  async updateProject(
    @Id() adminId: string,
    @Param('id') id: string,
    @Body() updateProjectDto: UpdateZoomProjectDto,
  ) {
    if (!mongoose.isValidObjectId(adminId) || !mongoose.isValidObjectId(id)) {
      return { statusCode: HttpStatus.BAD_REQUEST, message: 'Invalid request', data: null };
    }
    const project = await this.zoomService.updateProject(
      new Types.ObjectId(`${adminId}`),
      new Types.ObjectId(`${id}`),
      updateProjectDto,
    );
    if (!project) {
      return { statusCode: HttpStatus.NOT_FOUND, message: 'Project not found', data: null };
    }
    return { statusCode: HttpStatus.OK, message: 'Project updated', data: project };
  }

  @Delete('projects/:id')
  async deleteProject(@Id() adminId: string, @Param('id') id: string) {
    if (!mongoose.isValidObjectId(adminId) || !mongoose.isValidObjectId(id)) {
      return { statusCode: HttpStatus.BAD_REQUEST, message: 'Invalid request', data: null };
    }
    const deleted = await this.zoomService.deleteProject(new Types.ObjectId(`${adminId}`), new Types.ObjectId(`${id}`));
    if (!deleted) {
      return { statusCode: HttpStatus.NOT_FOUND, message: 'Project not found', data: null };
    }
    return { statusCode: HttpStatus.OK, message: 'Project deleted', data: { id } };
  }

  @Get('projects/by-account/:accountId')
  async getProjectByAccountId(@Id() adminId: string, @Param('accountId') accountId: string) {
    if (!mongoose.isValidObjectId(adminId) || !accountId) {
      return { statusCode: HttpStatus.BAD_REQUEST, message: 'Invalid request', data: null };
    }
    const project = await this.zoomService.getProjectByAccountId(new Types.ObjectId(`${adminId}`), accountId);
    if (!project) {
      return { statusCode: HttpStatus.NOT_FOUND, message: 'Project not found', data: null };
    }
    return { statusCode: HttpStatus.OK, message: 'Project retrieved', data: project };
  }

  @Get('projects/:id/configuration-status')
  async getProjectConfigurationStatus(@Id() adminId: string, @Param('id') id: string) {
    if (!mongoose.isValidObjectId(adminId) || !mongoose.isValidObjectId(id)) {
      return { statusCode: HttpStatus.BAD_REQUEST, message: 'Invalid request', data: null };
    }
    const status = await this.zoomService.getProjectConfigurationStatus(new Types.ObjectId(`${adminId}`), new Types.ObjectId(`${id}`));
    return { statusCode: HttpStatus.OK, message: 'Configuration status retrieved', data: status };
  }

  @Get('projects/:id/webhook-subscription-status')
  async getWebhookSubscriptionStatus(@Id() adminId: string, @Param('id') id: string) {
    if (!mongoose.isValidObjectId(adminId) || !mongoose.isValidObjectId(id)) {
      return { statusCode: HttpStatus.BAD_REQUEST, message: 'Invalid request', data: null };
    }
    const status = await this.zoomService.checkWebhookSubscriptionStatus(
      new Types.ObjectId(`${adminId}`),
      new Types.ObjectId(`${id}`),
    );
    return { statusCode: HttpStatus.OK, message: 'Webhook subscription status retrieved', data: status };
  }

  @Get('projects/:id/meetings')
  async getProjectMeetings(
    @Id() adminId: string,
    @Param('id') id: string,
    @Query('type') type: 'scheduled' | 'upcoming' | 'live' | 'past' | 'pending' = 'upcoming',
    @Query('pageSize') pageSize?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!mongoose.isValidObjectId(adminId) || !mongoose.isValidObjectId(id)) {
      return { statusCode: HttpStatus.BAD_REQUEST, message: 'Invalid request', data: null };
    }
    const result = await this.zoomService.getProjectMeetings(
      new Types.ObjectId(`${adminId}`),
      new Types.ObjectId(`${id}`),
      type,
      { pageSize: pageSize ? Number(pageSize) : 30, from, to },
    );
    return { statusCode: HttpStatus.OK, message: 'Meetings retrieved', data: result };
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
      return { statusCode: HttpStatus.BAD_REQUEST, message: 'Invalid request', data: null };
    }
    const result = await this.zoomService.getProjectWebinars(
      new Types.ObjectId(`${adminId}`),
      new Types.ObjectId(`${id}`),
      type,
      { pageSize: pageSize ? Number(pageSize) : 30, from, to },
    );
    return { statusCode: HttpStatus.OK, message: 'Webinars retrieved', data: result };
  }

  @Get('projects/:id/webinars/:webinarId')
  async getWebinarDetails(
    @Id() adminId: string,
    @Param('id') id: string,
    @Param('webinarId') webinarId: string,
  ) {
    if (!mongoose.isValidObjectId(adminId) || !mongoose.isValidObjectId(id) || !webinarId) {
      return { statusCode: HttpStatus.BAD_REQUEST, message: 'Invalid request', data: null };
    }
    const result = await this.zoomService.getWebinarDetails(
      new Types.ObjectId(`${adminId}`),
      new Types.ObjectId(`${id}`),
      webinarId,
    );
    return { statusCode: HttpStatus.OK, message: 'Webinar details retrieved', data: result };
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
    if (!mongoose.isValidObjectId(adminId) || !mongoose.isValidObjectId(id) || !webinarId) {
      return { statusCode: HttpStatus.BAD_REQUEST, message: 'Invalid request', data: null };
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
    return { statusCode: HttpStatus.OK, message: 'Webinar registrants retrieved', data: result };
  }

  @Get('projects/:id/meetings/:meetingId')
  async getMeetingDetails(
    @Id() adminId: string,
    @Param('id') id: string,
    @Param('meetingId') meetingId: string,
  ) {
    if (!mongoose.isValidObjectId(adminId) || !mongoose.isValidObjectId(id) || !meetingId) {
      return { statusCode: HttpStatus.BAD_REQUEST, message: 'Invalid request', data: null };
    }
    const result = await this.zoomService.getMeetingDetails(
      new Types.ObjectId(`${adminId}`),
      new Types.ObjectId(`${id}`),
      meetingId,
    );
    return { statusCode: HttpStatus.OK, message: 'Meeting details retrieved', data: result };
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
    if (!mongoose.isValidObjectId(adminId) || !mongoose.isValidObjectId(id) || !meetingId) {
      return { statusCode: HttpStatus.BAD_REQUEST, message: 'Invalid request', data: null };
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
    return { statusCode: HttpStatus.OK, message: 'Meeting registrants retrieved', data: result };
  }

}

