import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { QuickReply } from './schemas/quick-reply.schema';

@Injectable()
export class QuickRepliesService {
  constructor(
    @InjectModel(QuickReply.name) private readonly quickReplyModel: Model<QuickReply>,
  ) {}

  async create(adminId: Types.ObjectId, payload: any) {
    const newQR = new this.quickReplyModel({
      ...payload,
      adminId,
      projectId: new Types.ObjectId(String(payload.projectId)),
    });
    return await newQR.save();
  }

  async list(projectId: string) {
    return await this.quickReplyModel.find({ 
      projectId: new Types.ObjectId(projectId) 
    }).sort({ createdAt: -1 }).exec();
  }

  async delete(id: string) {
    const result = await this.quickReplyModel.findByIdAndDelete(id);
    if (!result) throw new NotFoundException('Quick reply not found');
    return result;
  }
}
