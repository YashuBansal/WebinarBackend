import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AutomationFlow,
  AutomationFlowDocument,
} from './schemas/automation-flow.schema';
import {
  AutomationExecution,
  AutomationExecutionDocument,
} from './schemas/automation-execution.schema';
import {
  CreateAutomationFlowDto,
  UpdateAutomationFlowDto,
} from './dto/automation.dto';

@Injectable()
export class AutomationsService {
  constructor(
    @InjectModel(AutomationFlow.name)
    private flowModel: Model<AutomationFlowDocument>,
    @InjectModel(AutomationExecution.name)
    private execModel: Model<AutomationExecutionDocument>,
  ) {}

  async createFlow(
    adminId: string,
    projectId: string,
    dto: CreateAutomationFlowDto,
  ) {
    return this.flowModel.create({
      adminId: new Types.ObjectId(adminId),
      projectId: new Types.ObjectId(projectId),
      name: dto.name,
      status: dto.status ?? 'inactive',
      flowType: dto.flowType ?? 'crm',
      webinarId: dto.webinarId ? new Types.ObjectId(dto.webinarId) : undefined,
      graph: dto.graph,
    });
  }

  async getFlows(adminId: string, projectId: string, flowType?: string) {
    const query: any = {
      adminId: new Types.ObjectId(adminId),
      projectId: new Types.ObjectId(projectId),
    };
    if (flowType) {
      query.flowType = flowType;
    }
    return this.flowModel
      .find(query)
      .sort({ createdAt: -1 })
      .lean();
  }

  async getFlowById(adminId: string, projectId: string, id: string) {
    const flow = await this.flowModel.findOne({
      _id: new Types.ObjectId(id),
      adminId: new Types.ObjectId(adminId),
      projectId: new Types.ObjectId(projectId),
    });
    if (!flow) throw new NotFoundException('Automation flow not found');
    return flow;
  }

  async updateFlow(
    adminId: string,
    projectId: string,
    id: string,
    dto: UpdateAutomationFlowDto,
  ) {
    const flow = await this.flowModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(id),
        adminId: new Types.ObjectId(adminId),
        projectId: new Types.ObjectId(projectId),
      },
      {
        $set: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(dto.webinarId !== undefined
            ? { webinarId: new Types.ObjectId(dto.webinarId) }
            : {}),
          ...(dto.graph !== undefined ? { graph: dto.graph } : {}),
        },
      },
      { new: true },
    );
    if (!flow) throw new NotFoundException('Automation flow not found');
    return flow;
  }

  async deleteFlow(adminId: string, projectId: string, id: string) {
    const res = await this.flowModel.findOneAndDelete({
      _id: new Types.ObjectId(id),
      adminId: new Types.ObjectId(adminId),
      projectId: new Types.ObjectId(projectId),
    });
    if (!res) throw new NotFoundException('Automation flow not found');
    return { success: true };
  }

  async findByName(
    adminId: string,
    projectId: string,
    name: string,
    excludeFlowId?: string,
  ) {
    const query: any = {
      adminId: new Types.ObjectId(adminId),
      projectId: new Types.ObjectId(projectId),
      name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
    };
    if (excludeFlowId) {
      query._id = { $ne: new Types.ObjectId(excludeFlowId) };
    }
    return this.flowModel.findOne(query).lean();
  }

  async createExecution(
    adminId: string,
    projectId: string,
    flowId: string,
    triggerData: any,
  ) {
    return this.execModel.create({
      adminId: new Types.ObjectId(adminId),
      projectId: new Types.ObjectId(projectId),
      flowId: new Types.ObjectId(flowId),
      status: 'PENDING',
      triggerData,
      logs: [
        {
          timestamp: new Date().toISOString(),
          level: 'info',
          message: 'Execution created',
        },
      ],
    });
  }
}
