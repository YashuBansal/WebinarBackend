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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { WhatsappService } from './whatsapp.service';
import { Id } from 'src/decorators/custom.decorator';
import mongoose, { Types } from 'mongoose';
import {
  CreateTemplateDto,
  UpdateTemplateDto,
  GetTemplatesQueryDto,
  DeleteTemplateDto,
} from './dto/template.dto';
import {
  SendTemplateMessageDto,
  SendBulkTemplateMessageDto,
} from './dto/msg.dto';

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

  @Post('templates')
  async fetchwabaTemplates() {
    const response = await this.whatsappService.getTemplatesForWabaTest();
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
    console.log('Received Webhook Verification Request:', { mode, token });

    try {
      this.whatsappService.verifyWebhookToken(mode, token);
      console.log(
        'Webhook verification successful. Responding with challenge.',
      );
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
    // We will build the logic for this in the service
    this.whatsappService.processWebhookPayload(body);
    // Meta doesn't care what's in the body, only that it gets a 200 OK
    // to acknowledge receipt. The actual processing should be done asynchronously.
    return;
  }

  @Get('data')
  async getWABAUsers(@Id() adminId: string) {
    if (!mongoose.isValidObjectId(adminId)) {
      throw new NotAcceptableException('Invalid Admin ID');
    }

    return await this.whatsappService.getWabaUserById(
      new Types.ObjectId(`${adminId}`),
    );
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

  @Get('templates/:projectId')
  @UsePipes(new ValidationPipe({ transform: true }))
  async getTemplates(
    @Param('projectId') projectId: string,
    @Id() adminId: string,
    @Query() query: GetTemplatesQueryDto,
  ) {
    if (!mongoose.isValidObjectId(projectId)) {
      throw new NotAcceptableException('Invalid Project ID');
    }

    const templates = await this.whatsappService.getTemplatesForWaba(
      new Types.ObjectId(`${adminId}`),
      new Types.ObjectId(`${projectId}`),
      query,
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Templates fetched successfully',
      data: templates,
    };
  }

  @Post('templates/:projectId')
  @UsePipes(new ValidationPipe({ transform: true }))
  async createTemplate(
    @Param('projectId') projectId: string,
    @Body() createTemplateDto: CreateTemplateDto,
    @Id() adminId: string,
  ) {
    if (!mongoose.isValidObjectId(projectId)) {
      throw new NotAcceptableException('Invalid Project ID');
    }

    const result = await this.whatsappService.createTemplateForWaba(
      new Types.ObjectId(`${adminId}`),
      new Types.ObjectId(`${projectId}`),
      createTemplateDto,
    );
    return {
      statusCode: HttpStatus.CREATED,
      message: 'Template submitted for review successfully!',
    };
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

  @Delete('templates/:projectId')
  @UsePipes(new ValidationPipe({ transform: true }))
  async deleteTemplate(
    @Param('projectId') projectId: string,
    @Query() deleteTemplateDto: DeleteTemplateDto,
    @Id() adminId: string,
  ) {
    if (!mongoose.isValidObjectId(projectId)) {
      throw new NotAcceptableException('Invalid Project ID');
    }

    const result = await this.whatsappService.deleteTemplateForWaba(
      new Types.ObjectId(`${adminId}`),
      new Types.ObjectId(`${projectId}`),
      deleteTemplateDto,
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Template deleted successfully!',
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
    const result = await this.whatsappService.sendTemplateMessage(
      new Types.ObjectId(`${adminId}`),
      sendTemplateDto,
    );
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
      new Types.ObjectId(`${adminId}`),
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
      const normalizedType = type
        ? String(type).toLowerCase()
        : undefined;

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
}
