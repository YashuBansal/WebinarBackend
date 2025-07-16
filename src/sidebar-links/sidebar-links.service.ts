import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model, mongo, Types } from 'mongoose';
import { SidebarLinks } from '../schemas/SidebarLinks.schema'; // Import your SidebarLinks schema
import {
  CreateSidebarLinkDto,
  UpdateSidebarLinkDto,
} from './dto/sidebar-links.dto';

@Injectable()
export class SidebarLinksService {
  constructor(
    @InjectModel(SidebarLinks.name)
    private sidebarLinksModel: Model<SidebarLinks>,
  ) {}

  async create(
    createSidebarLinkDto: CreateSidebarLinkDto,
  ): Promise<SidebarLinks> {
    const createdSidebarLink = new this.sidebarLinksModel({
      ...createSidebarLinkDto,
      role: mongoose.isValidObjectId(createSidebarLinkDto.role)
        ? new Types.ObjectId(createSidebarLinkDto.role)
        : null,
    });
    return createdSidebarLink.save();
  }

  async findAll(role: string): Promise<SidebarLinks[]> {
    if(!mongoose.isValidObjectId(role)) return [];
    const query = {
      $or: [
        {
          role: null,
        },
        {
          role: new Types.ObjectId(role),
        },
      ],
    };
    return this.sidebarLinksModel.find(query).populate('role').exec();
  }

  async findAllForSuperAdmin(): Promise<SidebarLinks[]> {
    return this.sidebarLinksModel.find().populate('role').exec();
  }

  async findOne(id: string): Promise<SidebarLinks> {
    return this.sidebarLinksModel.findById(id).exec();
  }

  async update(
    id: string,
    updateSidebarLinkDto: UpdateSidebarLinkDto,
  ): Promise<any> {
    let result = await this.sidebarLinksModel
      .findByIdAndUpdate(id, updateSidebarLinkDto, { new: true })
      .exec();
    return result;
  }

  async remove(id: string): Promise<void> {
    await this.sidebarLinksModel.findByIdAndDelete(id).exec();
  }
}
