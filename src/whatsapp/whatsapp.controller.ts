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
  } from '@nestjs/common';
  import { Response } from 'express';
  import { WhatsappService } from './whatsapp.service';
  import { AdminId, Id } from 'src/decorators/custom.decorator';
  import mongoose, { Types } from 'mongoose';
  import { 
    CreateTemplateDto, 
    UpdateTemplateDto, 
    GetTemplatesQueryDto, 
    DeleteTemplateDto,
    TemplateResponseDto 
  } from './dto/template.dto';
import { SendTemplateMessageDto } from './dto/msg.dto';
//   import { SendTemplateMessageDto } from './dto/msg.dto';
  
  @Controller('whatsapp')
  export class WhatsappController {
    constructor(private readonly whatsappService: WhatsappService) {}
  
    // --- NEW ENDPOINT ---
    /**
     * @description Receives an authorization code from the frontend after a successful
     * Embedded Signup flow. It exchanges this code for a long-lived access token,
     * fetches WABA details, and saves them to the database, linked to the logged-in admin.
     * @param code The authorization code from Meta.
     * @param req The authenticated request object, containing the logged-in user's details.
     */
    @Post('exchange-code')
    async exchangeCode(@Body('code') code: string, @Id() adminId: string, @Body('projectId') projectId: string) {
      console.log('----------------------------', code, adminId, projectId);
      if (!code || !mongoose.isValidObjectId(adminId) || !mongoose.isValidObjectId(projectId)) {
        throw new ForbiddenException(
          'Authorization code, user context, and project ID are required.',
        );
      }
  
      const newWabaConnection =
        await this.whatsappService.exchangeCodeAndSaveWaba(code, 
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
  
       @Post('message')
    async sendMessage() {
      const response = await this.whatsappService.sendTemplateMessagetest2();
      return {
        statusCode: HttpStatus.CREATED,
        message: 'WhatsApp Business Account connected successfully!',
        data: response,
      };
    }
  
    /**
     * @description Handles the webhook verification GET request from Meta.
     * This is the endpoint you set as the "Valid OAuth Redirect URI" or "Webhook URL".
     * @param mode The mode from the query parameters (should be 'subscribe').
     * @param challenge The challenge string to echo back.
     * @param token The verification token you set in your Meta App Dashboard.
     * @param res The Express response object to send the challenge back.
     */
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
  
    /**
     * @description Handles incoming data from the webhook after verification.
     * All message status updates and incoming messages will be sent here.
     */
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
  
    @Get('templates/:projectId')
    @UsePipes(new ValidationPipe({ transform: true }))
    async getTemplates(
      @Param('projectId') projectId: string, 
      @Id() adminId: string,
      @Query() query: GetTemplatesQueryDto
    ) {
      if (!mongoose.isValidObjectId(projectId)) {
        throw new NotAcceptableException('Invalid Project ID');
      }

      const templates = await this.whatsappService.getTemplatesForWaba(
        new Types.ObjectId(`${adminId}`),
        new Types.ObjectId(`${projectId}`),
        query
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
        data: result,
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
  }
  