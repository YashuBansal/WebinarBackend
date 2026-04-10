import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Headers,
} from '@nestjs/common';
import { WebinarWebhookService } from './webinar-webhook.service';
import { CreateWebinarWebhookDto } from './dto/create-webinar-webhook.dto';
import { UpdateWebinarWebhookDto } from './dto/create-webinar-webhook.dto';
import { Id } from 'src/decorators/custom.decorator';
import { Types } from 'mongoose';

@Controller('webinar-webhook')
export class WebinarWebhookController {
  constructor(private readonly webinarWebhookService: WebinarWebhookService) {}

  @Post()
  async create(
    @Body() createWebinarWebhookDto: CreateWebinarWebhookDto,
    @Id() adminId: string,
  ) {
    const webhook = await this.webinarWebhookService.create(
      createWebinarWebhookDto,
      new Types.ObjectId(adminId),
    );
    return {
      success: true,
      message: 'Webhook created successfully',
      data: webhook,
    };
  }

  @Get()
  async findAll(@Query('webinarId') webinarId: string, @Id() adminId: string) {
    const webhooks = await this.webinarWebhookService.findAll(
      webinarId,
      new Types.ObjectId(adminId),
    );
    return {
      success: true,
      message: 'Webhooks fetched successfully',
      data: webhooks,
    };
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Id() adminId: string) {
    const webhook = await this.webinarWebhookService.findOne(
      id,
      new Types.ObjectId(adminId),
    );
    return {
      success: true,
      message: 'Webhook fetched successfully',
      data: webhook,
    };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateWebinarWebhookDto: UpdateWebinarWebhookDto,
    @Id() adminId: string,
  ) {
    const webhook = await this.webinarWebhookService.update(
      id,
      updateWebinarWebhookDto,
      new Types.ObjectId(adminId),
    );
    return {
      success: true,
      message: 'Webhook updated successfully',
      data: webhook,
    };
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Id() adminId: string) {
    await this.webinarWebhookService.remove(id, new Types.ObjectId(adminId));
    return {
      success: true,
      message: 'Webhook deleted successfully',
    };
  }

  // Public endpoint to receive webhook data
  @Post('receive/:token')
  async receiveWebhook(
    @Param('token') token: string,
    @Body() body: any,
    @Headers() headers: any,
  ) {
    try {
      const result = await this.webinarWebhookService.receiveWebhookData(
        token,
        {
          body,
          headers,
          timestamp: new Date(),
        },
      );

      // Return appropriate response based on the action taken
      if (result.action === 'data_captured') {
        return {
          success: true,
          event: 'data_captured',
          message: 'Webhook data received and saved',
          data: {
            webhookId: result.webhookId,
            dataCaptured: result.dataCaptured,
          },
        };
      } else if (result.action === 'attendee_creation_triggered') {
        return {
          success: true,
          event: 'attendee_creation_triggered',
          message: 'Attendee creation process initiated',
          data: {
            webhookId: result.webhookId,
            attendeeCreationTriggered: result.attendeeCreationTriggered,
          },
        };
      } else {
        return {
          success: true,
          event: 'no_action',
          message: 'Webhook data received but no action was taken',
          data: {
            webhookId: result.webhookId,
          },
        };
      }
    } catch (error) {
      return {
        success: false,
        message: error.message || 'Failed to receive webhook data',
      };
    }
  }
}
