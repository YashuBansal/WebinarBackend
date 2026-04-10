import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { AutomationsService } from './automations.service';
import {
  CreateAutomationFlowDto,
  UpdateAutomationFlowDto,
} from './dto/automation.dto';
import { AdminId } from 'src/decorators/custom.decorator';

@Controller('automations')
export class AutomationsController {
  constructor(private readonly automationsService: AutomationsService) {}

  @Post()
  async create(
    @AdminId() adminId: string,
    @Query('projectId') projectId: string,
    @Body() body: CreateAutomationFlowDto,
  ) {
    return this.automationsService.createFlow(adminId, projectId, body);
  }

  @Get()
  async list(
    @AdminId() adminId: string,
    @Query('projectId') projectId: string,
  ) {
    return this.automationsService.getFlows(adminId, projectId);
  }

  @Get(':id')
  async get(
    @AdminId() adminId: string,
    @Query('projectId') projectId: string,
    @Param('id') id: string,
  ) {
    return this.automationsService.getFlowById(adminId, projectId, id);
  }

  @Put(':id')
  async update(
    @AdminId() adminId: string,
    @Query('projectId') projectId: string,
    @Param('id') id: string,
    @Body() body: UpdateAutomationFlowDto,
  ) {
    return this.automationsService.updateFlow(adminId, projectId, id, body);
  }

  @Delete(':id')
  async remove(
    @AdminId() adminId: string,
    @Query('projectId') projectId: string,
    @Param('id') id: string,
  ) {
    return this.automationsService.deleteFlow(adminId, projectId, id);
  }
}
