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
import { Contact, ContactDocument } from 'src/contacts/Contact.schema';
import {
  CreateWabaTagDto,
  UpdateWabaTagDto,
  WabaTagFiltersDto,
} from './dto/waba-tags.dto';

@Injectable()
export class WabaTagsService {
  private readonly logger = new Logger(WabaTagsService.name);

  constructor(
    @InjectModel(WabaTag.name) private wabaTagModel: Model<WabaTagDocument>,
    @InjectModel(Contact.name) private contactModel: Model<ContactDocument>,
  ) {}

  async createWabaTag(
    createWabaTagDto: CreateWabaTagDto,
    adminId: Types.ObjectId,
  ): Promise<WabaTag> {
    const sanitizedName = createWabaTagDto.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_\-\.]/g, '');

    if (!sanitizedName) {
      throw new BadRequestException(
        'Tag name contains only invalid characters',
      );
    }

    const existingTag = await this.wabaTagModel.findOne({
      name: sanitizedName,
      adminId,
      projectId: new Types.ObjectId(createWabaTagDto.projectId),
    });

    if (existingTag) {
      throw new ConflictException(
        'Tag with this name already exists in this project',
      );
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

  async getWabaTagById(
    tagId: string,
    adminId: Types.ObjectId,
  ): Promise<WabaTag> {
    if (!Types.ObjectId.isValid(tagId)) {
      throw new BadRequestException('Invalid tag ID');
    }

    const wabaTag = await this.wabaTagModel
      .findOne({
        _id: new Types.ObjectId(tagId),
        adminId,
      })
      .populate('projectId', 'name');

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
      const previousName = wabaTag.name;
      const sanitizedName = updateWabaTagDto.name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9_\-\.]/g, '');

      if (!sanitizedName) {
        throw new BadRequestException(
          'Tag name contains only invalid characters',
        );
      }

      // Check if another tag with the same name exists in the same project
      const existingTag = await this.wabaTagModel.findOne({
        name: sanitizedName,
        adminId,
        projectId: wabaTag.projectId,
        _id: { $ne: new Types.ObjectId(tagId) },
      });

      if (existingTag) {
        throw new ConflictException(
          'Tag with this name already exists in this project',
        );
      }

      wabaTag.name = sanitizedName;

      if (sanitizedName !== previousName) {
        await this.contactModel.updateMany(
          {
            adminId,
            projectId: wabaTag.projectId,
            isDeleted: false,
            tags: previousName,
          },
          {
            $set: { 'tags.$[tagName]': sanitizedName },
          },
          {
            arrayFilters: [{ tagName: previousName }],
          },
        );
      }
    }

    return await wabaTag.save();
  }

  async deleteWabaTag(
    tagId: string,
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

    await this.contactModel.updateMany(
      {
        adminId,
        projectId: wabaTag.projectId,
        isDeleted: false,
      },
      { $pull: { tags: wabaTag.name } },
    );

    await this.wabaTagModel.deleteOne({ _id: new Types.ObjectId(tagId) });
    return wabaTag;
  }

  async getWabaTagsByProject(
    projectId: string,
    adminId: Types.ObjectId,
  ): Promise<WabaTag[]> {
    return this.wabaTagModel
      .find({
        projectId: new Types.ObjectId(projectId),
        adminId,
      })
      .sort({ createdAt: -1 });
  }

  async ensureTagsExist(
    projectId: Types.ObjectId,
    adminId: Types.ObjectId,
    tags: string[],
  ): Promise<void> {
    if (!Array.isArray(tags) || tags.length === 0) return;

    const candidateNames = Array.from(
      new Set(
        tags
          .map((tag) =>
            String(tag)
              .toLowerCase()
              .trim()
              .replace(/[^a-z0-9_\-\.]/g, ''),
          )
          .filter(Boolean),
      ),
    );

    if (candidateNames.length === 0) return;

    const existing = await this.wabaTagModel
      .find({
        projectId,
        adminId,
        name: { $in: candidateNames },
      })
      .select(['name'])
      .lean();

    const existingNames = new Set(existing.map((tag) => tag.name));
    const missingNames = candidateNames.filter(
      (name) => !existingNames.has(name),
    );

    if (missingNames.length === 0) return;

    try {
      await this.wabaTagModel.insertMany(
        missingNames.map((name) => ({
          name,
          projectId,
          adminId,
        })),
        { ordered: false },
      );
    } catch (error) {
      this.logger.warn(
        `Some tags already existed while auto-creating tags for project ${projectId.toString()}: ${error?.message ?? String(error)}`,
      );
    }
  }
}
