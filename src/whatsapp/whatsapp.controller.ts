import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  Res,
  ForbiddenException,
  NotAcceptableException,
  Param,
  Delete,
  Patch,
  ValidationPipe,
  UsePipes,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { WhatsappService } from './whatsapp.service';
import { Id } from 'src/decorators/custom.decorator';
import mongoose, { Types } from 'mongoose';
import { UpdateTemplateDto } from './dto/template.dto';
import {
  SendTemplateMessageDto,
  SendBulkTemplateMessageDto,
} from './dto/msg.dto';
import { WabaMessageType } from 'src/whatsapp-embed/waba-message/waba-message.schema';

@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  @Post('exchange-code')
  async exchangeCode(
    @Body('code') code: string,
    @Id() adminId: string,
    @Body('projectId') projectId: string,
  ) {
    if (
      !code ||
      !mongoose.isValidObjectId(adminId) ||
      !mongoose.isValidObjectId(projectId)
    ) {
      throw new ForbiddenException(
        'Authorization code, user context, and project ID are required.',
      );
    }

    const newWabaConnection =
      await this.whatsappService.exchangeCodeAndSaveWaba(
        code,
        new Types.ObjectId(`${adminId}`),
        new Types.ObjectId(`${projectId}`),
      );
    return {
      statusCode: HttpStatus.CREATED,
      message: 'WhatsApp Business Account connected successfully!',
      data: newWabaConnection,
    };
  }

  @Post('fetch')
  async fetchwaba() {
    const response = await this.whatsappService.getWabaDetailsTest();
    return {
      statusCode: HttpStatus.CREATED,
      message: 'WhatsApp Business Account connected successfully!',
      data: response,
    };
  }

  @Get('webhook')
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.challenge') challenge: string,
    @Query('hub.verify_token') token: string,
    @Res() res: Response,
  ) {
    try {
      this.whatsappService.verifyWebhookToken(mode, token);
      // Respond with the challenge token
      res.status(HttpStatus.OK).send(challenge);
    } catch (error) {
      console.error('Webhook verification failed:', error.message);
      // Let the service's exception bubble up (which is a ForbiddenException)
      throw error;
    }
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK) // Always respond with 200 OK immediately
  handleWebhookEvents(@Body() body: any) {
    // Enqueue webhook processing to background queue
    // This allows responding with 200 OK immediately to Meta
    this.whatsappService.enqueueWebhookProcessing(body);
    return;
  }

  @Post('templates/:projectId/upload-sample-media')
  @UseInterceptors(FileInterceptor('file'))
  async handleMediaUploadForTemplateSample(
    @UploadedFile() file: Express.Multer.File,
    @Id() adminId: string,
    @Param('projectId') projectId: string,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    if (!mongoose.isValidObjectId(projectId)) {
      throw new NotAcceptableException('Invalid Project ID');
    }

    // Validate file type
    const allowedMimeTypes = [
      'image/jpeg',
      'image/png',
      'image/jpg',
      'video/mp4',
      'video/3gpp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Invalid file type. Only images, videos, and documents are allowed.',
      );
    }

    // Validate file size
    const maxImageSize = 2 * 1024 * 1024; // 2MB
    const maxVideoDocSize = 16 * 1024 * 1024; // 16MB

    const isImage = file.mimetype.startsWith('image/');
    const maxSize = isImage ? maxImageSize : maxVideoDocSize;

    if (file.size > maxSize) {
      throw new BadRequestException(
        `File size too large. Maximum size for ${isImage ? 'images' : 'videos/documents'} is ${isImage ? '2MB' : '16MB'}.`,
      );
    }

    try {
      const headerHandle = await this.whatsappService.getMetaHeaderHandle(
        file.buffer,
        file.mimetype,
        file.originalname,
        new Types.ObjectId(`${adminId}`),
        new Types.ObjectId(`${projectId}`),
      );

      return {
        statusCode: HttpStatus.OK,
        message: 'Sample media uploaded successfully!',
        data: {
          headerHandle,
          fileName: file.originalname,
          fileSize: file.size,
          mimeType: file.mimetype,
        },
      };
    } catch (error) {
      throw new BadRequestException(
        `Failed to upload sample media: ${error.message}`,
      );
    }
  }

  @Patch('templates/:projectId/:templateId')
  @UsePipes(new ValidationPipe({ transform: true }))
  async updateTemplate(
    @Param('projectId') projectId: string,
    @Param('templateId') templateId: string,
    @Body() updateTemplateDto: UpdateTemplateDto,
    @Id() adminId: string,
  ) {
    if (!mongoose.isValidObjectId(projectId)) {
      throw new NotAcceptableException('Invalid Project ID');
    }

    const result = await this.whatsappService.updateTemplateForWaba(
      new Types.ObjectId(`${adminId}`),
      new Types.ObjectId(`${projectId}`),
      templateId,
      updateTemplateDto,
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Template updated successfully!',
      data: result,
    };
  }

  @Get('templates/:projectId/:templateId')
  async getTemplateById(
    @Param('projectId') projectId: string,
    @Param('templateId') templateId: string,
    @Id() adminId: string,
  ) {
    if (!mongoose.isValidObjectId(projectId)) {
      throw new NotAcceptableException('Invalid Project ID');
    }

    const template = await this.whatsappService.getTemplateById(
      new Types.ObjectId(`${adminId}`),
      new Types.ObjectId(`${projectId}`),
      templateId,
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Template fetched successfully',
      data: template,
    };
  }

  @Post('send-template')
  @UsePipes(new ValidationPipe({ transform: true }))
  async sendTemplateMessage(
    @Body() sendTemplateDto: SendTemplateMessageDto,
    @Id() adminId: string,
  ) {
    await this.whatsappService.checkVariableMappingLength({
      adminId,
      projectId: sendTemplateDto.projectId,
      templateName: sendTemplateDto.templateName,
      givenVariableLength: Array.isArray(sendTemplateDto.bodyVariables)
        ? sendTemplateDto.bodyVariables.filter((a) => Boolean(a)).length
        : 0,
      headerMediaAssetId: sendTemplateDto.headerMediaAssetId,
    });

    const result = await this.whatsappService.sendTemplateMessagev2({
      adminId,
      sendTemplateDto: {
        projectId: sendTemplateDto.projectId,
        recipients: [
          {
            recipientPhoneNumber: sendTemplateDto.recipientPhoneNumber,
            contactId: sendTemplateDto.contactId,
            bodyVariables: sendTemplateDto.bodyVariables,
          },
        ],
        templateName: sendTemplateDto.templateName,
        headerMediaAssetId: sendTemplateDto.headerMediaAssetId,
        language: sendTemplateDto.language,
      },
      messageType: WabaMessageType.INDIVIDUAL,
    });
    return {
      statusCode: HttpStatus.OK,
      message: 'Template message sent successfully!',
      data: result,
    };
  }

  @Post('send-bulk-template')
  @UsePipes(new ValidationPipe({ transform: true }))
  async sendBulkTemplateMessage(
    @Body() sendBulkTemplateDto: SendBulkTemplateMessageDto,
    @Id() adminId: string,
  ) {
    const result = await this.whatsappService.sendBulkTemplateMessage(
      adminId,
      sendBulkTemplateDto,
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Bulk template messages sent successfully!',
      data: result,
    };
  }

  @Post('upload-media-asset')
  @UseInterceptors(FileInterceptor('file'))
  async uploadMediaForSending(
    @UploadedFile() file: Express.Multer.File,
    @Id() adminId: string,
    @Body('projectId') projectId: string,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    if (!mongoose.isValidObjectId(projectId)) {
      throw new BadRequestException('Invalid project ID');
    }

    // Validate file type
    const allowedMimeTypes = [
      'image/jpeg',
      'image/png',
      'image/jpg',
      'video/mp4',
      'video/3gpp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Invalid file type. Only images, videos, and documents are allowed.',
      );
    }

    // Validate file size
    const maxImageSize = 2 * 1024 * 1024; // 2MB
    const maxVideoDocSize = 16 * 1024 * 1024; // 16MB

    const isImage = file.mimetype.startsWith('image/');
    const maxSize = isImage ? maxImageSize : maxVideoDocSize;

    if (file.size > maxSize) {
      throw new BadRequestException(
        `File size too large. Maximum size for ${isImage ? 'images' : 'videos/documents'} is ${isImage ? '2MB' : '16MB'}.`,
      );
    }

    try {
      const mediaAsset = await this.whatsappService.uploadMediaAsset(
        file,
        new Types.ObjectId(`${adminId}`),
        new Types.ObjectId(`${projectId}`),
      );

      return {
        statusCode: HttpStatus.OK,
        message: 'Media asset uploaded successfully!',
        data: {
          mediaAssetId: mediaAsset._id,
          fileName: mediaAsset.fileName,
          filePath: mediaAsset.filePath,
          fileSize: mediaAsset.fileSize,
          mimeType: mediaAsset.mimeType,
        },
      };
    } catch (error) {
      throw new BadRequestException(
        `Failed to upload media asset: ${error.message}`,
      );
    }
  }

  @Get('media-assets')
  async getMediaAssets(
    @Id() adminId: string,
    @Query('projectId') projectId: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
    @Query('type') type?: string,
  ) {
    if (!mongoose.isValidObjectId(projectId)) {
      throw new BadRequestException('Invalid project ID');
    }

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    if (isNaN(pageNum) || pageNum < 1) {
      throw new BadRequestException('Invalid page number');
    }

    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      throw new BadRequestException('Invalid limit. Must be between 1 and 100');
    }

    try {
      // Normalize type filter if provided
      const normalizedType = type ? String(type).toLowerCase() : undefined;

      const result = await this.whatsappService.getMediaAssets(
        new Types.ObjectId(adminId),
        new Types.ObjectId(projectId),
        pageNum,
        limitNum,
        normalizedType as 'image' | 'video' | 'document' | undefined,
      );

      return {
        statusCode: HttpStatus.OK,
        message: 'Media assets fetched successfully!',
        data: result,
      };
    } catch (error) {
      throw new BadRequestException(
        `Failed to fetch media assets: ${error.message}`,
      );
    }
  }

  @Delete('media-assets/:mediaAssetId')
  async deleteMediaAsset(
    @Id() adminId: string,
    @Query('projectId') projectId: string,
    @Param('mediaAssetId') mediaAssetId: string,
  ) {
    if (!mongoose.isValidObjectId(projectId)) {
      throw new BadRequestException('Invalid project ID');
    }

    if (!mongoose.isValidObjectId(mediaAssetId)) {
      throw new BadRequestException('Invalid media asset ID');
    }

    try {
      const deletedMediaAsset = await this.whatsappService.deleteMediaAsset(
        new Types.ObjectId(adminId),
        new Types.ObjectId(projectId),
        new Types.ObjectId(mediaAssetId),
      );

      return {
        statusCode: HttpStatus.OK,
        message: 'Media asset deleted successfully!',
        data: deletedMediaAsset,
      };
    } catch (error) {
      throw new BadRequestException(
        `Failed to delete media asset: ${error.message}`,
      );
    }
  }

  @Get('chat')
  async getChatMessages(
    @Id() adminId: string,
    @Query('projectId') projectId: string,
    @Query('phoneNumber') phoneNumber: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    if (!mongoose.isValidObjectId(projectId)) {
      throw new BadRequestException('Invalid project ID');
    }
    if (!phoneNumber) {
      throw new BadRequestException('phoneNumber is required');
    }

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    const result = await this.whatsappService.getChatMessages(
      new Types.ObjectId(adminId),
      new Types.ObjectId(projectId),
      phoneNumber,
      pageNum,
      limitNum,
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Chat messages fetched successfully',
      data: result,
    };
  }

  @Post('chat/send-text')
  async sendChatText(
    @Id() adminId: string,
    @Body('projectId') projectId: string,
    @Body('phoneNumber') phoneNumber: string,
    @Body('text') text: string,
    @Body('contactId') contactId?: string,
    @Body('components') components?: any[],
  ) {
    if (!mongoose.isValidObjectId(projectId)) {
      throw new BadRequestException('Invalid project ID');
    }
    if (contactId && !mongoose.isValidObjectId(contactId)) {
      throw new BadRequestException('Invalid contact ID');
    }
    if (!phoneNumber || !text) {
      throw new BadRequestException('phoneNumber and text are required');
    }

    const result = await this.whatsappService.sendTextMessage(
      new Types.ObjectId(adminId),
      new Types.ObjectId(projectId),
      phoneNumber,
      text,
      contactId ? new Types.ObjectId(contactId) : undefined,
      { components },
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Message sent',
      data: result,
    };
  }

  @Get('chat/can-send-direct/:projectId/:phoneNumber')
  async canSendDirectMessage(
    @Id() adminId: string,
    @Param('projectId') projectId: string,
    @Param('phoneNumber') phoneNumber: string,
  ) {
    if (!mongoose.isValidObjectId(projectId)) {
      throw new BadRequestException('Invalid project ID');
    }
    if (!phoneNumber) {
      throw new BadRequestException('phoneNumber is required');
    }

    const result = await this.whatsappService.canSendDirectMessage(
      new Types.ObjectId(adminId),
      new Types.ObjectId(projectId),
      phoneNumber,
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Direct message permission checked',
      data: result,
    };
  }

  @Get('media-proxy')
  async proxyMedia(
    @Id() adminId: string,
    @Query('url') url: string,
    @Query('projectId') projectId: string,
    @Res() res: Response,
  ) {
    if (!url) {
      throw new BadRequestException('Media URL is required');
    }
    if (!mongoose.isValidObjectId(projectId)) {
      throw new BadRequestException('Invalid project ID');
    }
    if (!mongoose.isValidObjectId(adminId)) {
      throw new BadRequestException('Invalid admin ID');
    }

    try {
      // Get project to retrieve access token
      const project = await this.whatsappService['projectService'].findOne(
        new Types.ObjectId(adminId),
        new Types.ObjectId(projectId),
      );

      if (!project) {
        throw new ForbiddenException('Project not found or access denied');
      }

      if (!project.permanentAccessToken) {
        throw new BadRequestException('Project access token not configured');
      }

      // Proxy the media with authentication
      const { data, contentType } = await this.whatsappService.proxyMedia(
        url,
        project.permanentAccessToken,
      );

      // Set appropriate headers and send the media
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', data.length);
      res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
      res.send(data);
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw new ServiceUnavailableException('Failed to proxy media', error);
    }
  }
}
