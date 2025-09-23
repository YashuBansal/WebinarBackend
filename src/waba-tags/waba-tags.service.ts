import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { WabaTag, WabaTagDocument } from 'src/schemas/waba-tags.schema';
import { CreateWabaTagDto, UpdateWabaTagDto, WabaTagFiltersDto } from './dto/waba-tags.dto';

@Injectable()
export class WabaTagsService {
  private readonly logger = new Logger(WabaTagsService.name);

  constructor(@InjectModel(WabaTag.name) private wabaTagModel: Model<WabaTagDocument>) {}

  async createWabaTag(
    createWabaTagDto: CreateWabaTagDto,
    adminId: Types.ObjectId,
  ): Promise<WabaTag> {
    const sanitizedName = createWabaTagDto.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_\-\.]/g, '');

    if (!sanitizedName) {
      throw new BadRequestException('Tag name contains only invalid characters');
    }

    const existingTag = await this.wabaTagModel.findOne({
      name: sanitizedName,
      adminId,
      projectId: new Types.ObjectId(createWabaTagDto.projectId),
    });

    if (existingTag) {
      throw new ConflictException('Tag with this name already exists in this project');
    }

    const wabaTag = new this.wabaTagModel({
      name: sanitizedName,
      projectId: new Types.ObjectId(createWabaTagDto.projectId),
      adminId,
    });

    return await wabaTag.save();
  }

  async getWabaTags(
    adminId: Types.ObjectId,
    filters?: WabaTagFiltersDto,
  ): Promise<WabaTag[]> {
    const query: any = { adminId };

    if (filters?.projectId) {
      query.projectId = new Types.ObjectId(filters.projectId);
    }

    if (filters?.search) {
      query.name = { $regex: filters.search, $options: 'i' };
    }

    return this.wabaTagModel.find(query).sort({ createdAt: -1 });
  }

  async getWabaTagById(tagId: string, adminId: Types.ObjectId): Promise<WabaTag> {
    if (!Types.ObjectId.isValid(tagId)) {
      throw new BadRequestException('Invalid tag ID');
    }

    const wabaTag = await this.wabaTagModel.findOne({
      _id: new Types.ObjectId(tagId),
      adminId,
    }).populate('projectId', 'name');

    if (!wabaTag) {
      throw new NotFoundException('Tag not found');
    }

    return wabaTag;
  }

  async updateWabaTag(
    tagId: string,
    updateWabaTagDto: UpdateWabaTagDto,
    adminId: Types.ObjectId,
  ): Promise<WabaTag> {
    if (!Types.ObjectId.isValid(tagId)) {
      throw new BadRequestException('Invalid tag ID');
    }

    const wabaTag = await this.wabaTagModel.findOne({
      _id: new Types.ObjectId(tagId),
      adminId,
    });

    if (!wabaTag) {
      throw new NotFoundException('Tag not found');
    }

    if (updateWabaTagDto.name) {
      const sanitizedName = updateWabaTagDto.name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9_\-\.]/g, '');

      if (!sanitizedName) {
        throw new BadRequestException('Tag name contains only invalid characters');
      }

      // Check if another tag with the same name exists in the same project
      const existingTag = await this.wabaTagModel.findOne({
        name: sanitizedName,
        adminId,
        projectId: wabaTag.projectId,
        _id: { $ne: new Types.ObjectId(tagId) },
      });

      if (existingTag) {
        throw new ConflictException('Tag with this name already exists in this project');
      }

      wabaTag.name = sanitizedName;
    }

    return await wabaTag.save();
  }

  async deleteWabaTag(tagId: string, adminId: Types.ObjectId): Promise<WabaTag> {
    if (!Types.ObjectId.isValid(tagId)) {
      throw new BadRequestException('Invalid tag ID');
    }

    const wabaTag = await this.wabaTagModel.findOne({
      _id: new Types.ObjectId(tagId),
      adminId,
    });

    if (!wabaTag) {
      throw new NotFoundException('Tag not found');
    }

    await this.wabaTagModel.deleteOne({ _id: new Types.ObjectId(tagId) });
    return wabaTag;
  }

  async getWabaTagsByProject(
    projectId: string,
    adminId: Types.ObjectId,
  ): Promise<WabaTag[]> {
    return this.wabaTagModel.find({
      projectId: new Types.ObjectId(projectId),
      adminId,
    }).sort({ createdAt: -1 });
  }
}
