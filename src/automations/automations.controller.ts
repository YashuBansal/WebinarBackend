import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Patch,
  BadRequestException,
} from '@nestjs/common';
import { AutomationsService } from './automations.service';
import {
  CreateAutomationFlowDto,
  UpdateAutomationFlowDto,
} from './dto/automation.dto';
import { AdminId } from 'src/decorators/custom.decorator';
import mongoose from 'mongoose';

@Controller('automations')
export class AutomationsController {
  constructor(private readonly automationsService: AutomationsService) {}

  private validateIds(adminId: string, projectId: string) {
    if (!adminId || !mongoose.isValidObjectId(adminId)) {
      throw new BadRequestException('Invalid or missing adminId');
    }
    if (!projectId || !mongoose.isValidObjectId(projectId)) {
      throw new BadRequestException('Invalid or missing projectId');
    }
  }

  private async checkDuplicateName(
    adminId: string,
    projectId: string,
    name: string,
    excludeFlowId?: string,
  ) {
    if (!name) return;
    const existing = await this.automationsService.findByName(
      adminId,
      projectId,
      name,
      excludeFlowId,
    );
    if (existing) {
      throw new BadRequestException('Automation with this name already exists.');
    }
  }

  @Post()
  async create(
    @AdminId() adminId: string,
    @Query('adminId') queryAdminId: string,
    @Query('projectId') projectId: string,
    @Body() body: CreateAutomationFlowDto,
  ) {
    const resolvedAdminId = queryAdminId || adminId;
    this.validateIds(resolvedAdminId, projectId);
    await this.checkDuplicateName(resolvedAdminId, projectId, body.name);
    const flow = await this.automationsService.createFlow(resolvedAdminId, projectId, body);
    const flowObj = flow.toObject ? flow.toObject() : flow;
    return {
      ...flowObj,
      flowId: flow._id,
    };
  }

  @Post('flow')
  async saveFlow(
    @AdminId() adminId: string,
    @Query('adminId') queryAdminId: string,
    @Query('projectId') projectId: string,
    @Body() body: any,
  ) {
    const resolvedAdminId = queryAdminId || adminId;
    this.validateIds(resolvedAdminId, projectId);

    const flowId = body.id;
    await this.checkDuplicateName(resolvedAdminId, projectId, body.name, flowId);

    if (flowId) {
      // Update existing flow
      const flow = await this.automationsService.updateFlow(resolvedAdminId, projectId, flowId, body);
      const flowObj = flow.toObject ? flow.toObject() : flow;
      return {
        ...flowObj,
        flowId: flow._id,
      };
    } else {
      // Create new flow
      const flow = await this.automationsService.createFlow(resolvedAdminId, projectId, body);
      const flowObj = flow.toObject ? flow.toObject() : flow;
      return {
        ...flowObj,
        flowId: flow._id,
      };
    }
  }

  @Get()
  async list(
    @AdminId() adminId: string,
    @Query('adminId') queryAdminId: string,
    @Query('projectId') projectId: string,
    @Query('flowType') flowType: string,
  ) {
    const resolvedAdminId = queryAdminId || adminId;
    this.validateIds(resolvedAdminId, projectId);
    const flows = await this.automationsService.getFlows(resolvedAdminId, projectId, flowType);
    return flows.map(flow => {
      const flowObj = flow.toObject ? flow.toObject() : flow;
      return {
        ...flowObj,
        flowId: flow._id,
      };
    });
  }

  @Get('project/:projectId')
  async listByProject(
    @AdminId() adminId: string,
    @Query('adminId') queryAdminId: string,
    @Param('projectId') projectId: string,
    @Query('flowType') flowType: string,
  ) {
    const resolvedAdminId = queryAdminId || adminId;
    this.validateIds(resolvedAdminId, projectId);
    const flows = await this.automationsService.getFlows(resolvedAdminId, projectId, flowType);
    return flows.map(flow => {
      const flowObj = flow.toObject ? flow.toObject() : flow;
      return {
        ...flowObj,
        flowId: flow._id,
      };
    });
  }

  @Get(':id')
  async get(
    @AdminId() adminId: string,
    @Query('adminId') queryAdminId: string,
    @Query('projectId') projectId: string,
    @Param('id') id: string,
  ) {
    const resolvedAdminId = queryAdminId || adminId;
    this.validateIds(resolvedAdminId, projectId);
    const flow = await this.automationsService.getFlowById(resolvedAdminId, projectId, id);
    const flowObj = flow.toObject ? flow.toObject() : flow;
    return {
      ...flowObj,
      flowId: flow._id,
    };
  }

  @Put(':id')
  async update(
    @AdminId() adminId: string,
    @Query('adminId') queryAdminId: string,
    @Query('projectId') projectId: string,
    @Param('id') id: string,
    @Body() body: UpdateAutomationFlowDto,
  ) {
    const resolvedAdminId = queryAdminId || adminId;
    this.validateIds(resolvedAdminId, projectId);
    await this.checkDuplicateName(resolvedAdminId, projectId, body.name, id);
    const flow = await this.automationsService.updateFlow(resolvedAdminId, projectId, id, body);
    const flowObj = flow.toObject ? flow.toObject() : flow;
    return {
      ...flowObj,
      flowId: flow._id,
    };
  }

  @Patch('flow/:id/publish')
  async publish(
    @AdminId() adminId: string,
    @Query('adminId') queryAdminId: string,
    @Query('projectId') projectId: string,
    @Param('id') id: string,
  ) {
    const resolvedAdminId = queryAdminId || adminId;
    this.validateIds(resolvedAdminId, projectId);
    const flow = await this.automationsService.updateFlow(resolvedAdminId, projectId, id, {
      status: 'active',
    });
    const flowObj = flow.toObject ? flow.toObject() : flow;
    return {
      ...flowObj,
      flowId: flow._id,
    };
  }

  @Patch('flow/:id/status')
  async updateStatus(
    @AdminId() adminId: string,
    @Query('adminId') queryAdminId: string,
    @Query('projectId') projectId: string,
    @Param('id') id: string,
    @Body() body: { status: 'active' | 'inactive' },
  ) {
    const resolvedAdminId = queryAdminId || adminId;
    this.validateIds(resolvedAdminId, projectId);
    const flow = await this.automationsService.updateFlow(resolvedAdminId, projectId, id, {
      status: body.status,
    });
    const flowObj = flow.toObject ? flow.toObject() : flow;
    return {
      ...flowObj,
      flowId: flow._id,
    };
  }

  @Delete(':id')
  async remove(
    @AdminId() adminId: string,
    @Query('adminId') queryAdminId: string,
    @Query('projectId') projectId: string,
    @Param('id') id: string,
  ) {
    const resolvedAdminId = queryAdminId || adminId;
    this.validateIds(resolvedAdminId, projectId);
    return this.automationsService.deleteFlow(resolvedAdminId, projectId, id);
  }
}
