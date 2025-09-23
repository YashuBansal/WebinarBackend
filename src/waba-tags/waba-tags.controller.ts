import { 
  Controller, 
  Post, 
  Body, 
  Get, 
  Put, 
  Delete, 
  Param, 
  Query, 
  UseGuards 
} from '@nestjs/common';
import { CreateWabaTagDto, UpdateWabaTagDto, WabaTagFiltersDto } from './dto/waba-tags.dto';
import { AdminId, Id } from 'src/decorators/custom.decorator';
import { WabaTagsService } from './waba-tags.service';
import { Types } from 'mongoose';

@Controller('waba-tags')
export class WabaTagsController {
  constructor(private wabaTagsService: WabaTagsService) {}

  @Post()
  async createWabaTag(@Body() createWabaTagDto: CreateWabaTagDto, @Id() adminId: string) {
    const wabaTag = await this.wabaTagsService.createWabaTag(
      createWabaTagDto,
      new Types.ObjectId(`${adminId}`),
    );
    return {
      success: true,
      message: 'WABA Tag created successfully',
      data: wabaTag,
    };
  }

  @Get()
  async getWabaTags(
    @Id() adminId: string,
    @Query() filters: WabaTagFiltersDto,
  ) {
    if (!adminId) return null;
    const wabaTags = await this.wabaTagsService.getWabaTags(
      new Types.ObjectId(`${adminId}`),
      filters,
    );
    return {
      success: true,
      message: 'WABA Tags fetched successfully',
      data: wabaTags,
    };
  }

  @Get('project/:projectId')
  async getWabaTagsByProject(
    @Param('projectId') projectId: string,
    @Id() adminId: string,
  ) {
    if (!adminId) return null;
    const wabaTags = await this.wabaTagsService.getWabaTagsByProject(
      projectId,
      new Types.ObjectId(`${adminId}`),
    );
    return {
      success: true,
      message: 'WABA Tags fetched successfully',
      data: wabaTags,
    };
  }

  @Get(':id')
  async getWabaTagById(
    @Param('id') tagId: string,
    @Id() adminId: string,
  ) {
    if (!adminId) return null;
    const wabaTag = await this.wabaTagsService.getWabaTagById(
      tagId,
      new Types.ObjectId(`${adminId}`),
    );
    return {
      success: true,
      message: 'WABA Tag fetched successfully',
      data: wabaTag,
    };
  }

  @Put(':id')
  async updateWabaTag(
    @Param('id') tagId: string,
    @Body() updateWabaTagDto: UpdateWabaTagDto,
    @Id() adminId: string,
  ) {
    const wabaTag = await this.wabaTagsService.updateWabaTag(
      tagId,
      updateWabaTagDto,
      new Types.ObjectId(`${adminId}`),
    );
    return {
      success: true,
      message: 'WABA Tag updated successfully',
      data: wabaTag,
    };
  }

  @Delete(':id')
  async deleteWabaTag(
    @Param('id') tagId: string,
    @Id() adminId: string,
  ) {
    const wabaTag = await this.wabaTagsService.deleteWabaTag(
      tagId,
      new Types.ObjectId(`${adminId}`),
    );
    return {
      success: true,
      message: 'WABA Tag deleted successfully',
      data: wabaTag,
    };
  }
}
