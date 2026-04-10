import { Body, Controller, Param, Post, Query } from '@nestjs/common';
import { AutomationsService } from 'src/automations/automations.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AutomationFlow,
  AutomationFlowDocument,
} from 'src/automations/schemas/automation-flow.schema';

@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly automationsService: AutomationsService,
    @InjectModel(AutomationFlow.name)
    private flowModel: Model<AutomationFlowDocument>,
  ) {}

  // Public endpoint triggered by webinar registration tool (e.g., Pabbly)
  @Post('webinar-registration/:webinarId')
  async onWebinarRegistration(
    @Param('webinarId') webinarId: string,
    @Query('adminId') adminId: string,
    @Query('projectId') projectId: string,
    @Body() body: any,
  ) {
    // Find an active flow linked to the given webinar
    const flow = await this.flowModel.findOne({
      webinarId: new Types.ObjectId(webinarId),
      adminId: new Types.ObjectId(adminId),
      projectId: new Types.ObjectId(projectId),
      status: 'active',
    });

    if (!flow) {
      // Silently accept if no active flow is configured
      return { success: true, queued: false };
    }

    const exec = await this.automationsService.createExecution(
      adminId,
      projectId,
      `${flow._id}`,
      {
        type: 'webinar-registration',
        webinarId,
        payload: body,
      },
    );

    // In a later step, we'll push the job to a queue for processing
    return { success: true, queued: true, executionId: `${exec._id}` };
  }
}
