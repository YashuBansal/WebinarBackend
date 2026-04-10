import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  UsePipes,
  ValidationPipe,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProfileService } from './profile.service';
import { UpdateBusinessProfileDto } from './dto/profile.dto';
import { Id } from 'src/decorators/custom.decorator';
import { Types } from 'mongoose';

@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  /**
   * Sync business profile information from Meta into local cache
   */
  @Get(':projectId/sync')
  async syncBusinessProfile(
    @Param('projectId') projectId: string,
    @Id() adminId: string,
  ) {
    if (!Types.ObjectId.isValid(projectId)) {
      throw new BadRequestException('Invalid project ID');
    }

    const result = await this.profileService.syncBusinessProfile(
      new Types.ObjectId(adminId),
      new Types.ObjectId(projectId),
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Business profile synced successfully',
      data: result.data,
    };
  }

  /**
   * Get business profile information
   */
  @Get(':projectId')
  async getBusinessProfile(
    @Param('projectId') projectId: string,
    @Id() adminId: string,
  ) {
    if (!Types.ObjectId.isValid(projectId)) {
      throw new BadRequestException('Invalid project ID');
    }

    const profile = await this.profileService.getBusinessProfile(
      new Types.ObjectId(adminId),
      new Types.ObjectId(projectId),
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Business profile fetched successfully',
      data: profile,
    };
  }

  /**
   * Update business profile information
   */
  @Post(':projectId')
  @UsePipes(new ValidationPipe({ transform: true }))
  async updateBusinessProfile(
    @Param('projectId') projectId: string,
    @Body() updateProfileDto: UpdateBusinessProfileDto,
    @Id() adminId: string,
  ) {
    if (!Types.ObjectId.isValid(projectId)) {
      throw new BadRequestException('Invalid project ID');
    }

    const result = await this.profileService.updateBusinessProfile(
      new Types.ObjectId(adminId),
      new Types.ObjectId(projectId),
      updateProfileDto,
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Business profile updated successfully',
      data: result,
    };
  }

  /**
   * Get display name status
   */
  @Get(':projectId/display-name-status')
  async getDisplayNameStatus(
    @Param('projectId') projectId: string,
    @Id() adminId: string,
  ) {
    if (!Types.ObjectId.isValid(projectId)) {
      throw new BadRequestException('Invalid project ID');
    }

    const status = await this.profileService.getDisplayNameStatus(
      new Types.ObjectId(adminId),
      new Types.ObjectId(projectId),
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Display name status fetched successfully',
      data: status,
    };
  }

  /**
   * Get webhook subscription status
   */
  @Get(':projectId/webhook-subscription-status')
  async getWebhookSubscriptionStatus(
    @Param('projectId') projectId: string,
    @Id() adminId: string,
  ) {
    if (!Types.ObjectId.isValid(projectId)) {
      throw new BadRequestException('Invalid project ID');
    }

    const status = await this.profileService.checkWebhookSubscription(
      new Types.ObjectId(adminId),
      new Types.ObjectId(projectId),
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Webhook subscription status fetched successfully',
      data: status,
    };
  }

  /**
   * Subscribe webhook for a project
   */
  @Post(':projectId/webhook-subscription')
  async subscribeWebhook(
    @Param('projectId') projectId: string,
    @Id() adminId: string,
  ) {
    if (!Types.ObjectId.isValid(projectId)) {
      throw new BadRequestException('Invalid project ID');
    }

    const result = await this.profileService.subscribeWebhookForProject(
      new Types.ObjectId(adminId),
      new Types.ObjectId(projectId),
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Webhook subscription successful',
      data: result,
    };
  }

  /**
   * Upload profile picture
   */
  @Post(':projectId/profile-picture')
  @UseInterceptors(FileInterceptor('file'))
  async uploadProfilePicture(
    @UploadedFile() file: Express.Multer.File,
    @Param('projectId') projectId: string,
    @Id() adminId: string,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    if (!Types.ObjectId.isValid(projectId)) {
      throw new BadRequestException('Invalid project ID');
    }

    // Validate file type
    const allowedMimeTypes = [
      'image/jpeg',
      'image/png',
      'image/jpg',
      'image/webp',
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Invalid file type. Only JPEG, PNG, and WebP images are allowed.',
      );
    }

    // Validate file size (max 5MB for profile pictures)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      throw new BadRequestException(
        'File size too large. Maximum size for profile pictures is 5MB.',
      );
    }

    try {
      const fileHandle = await this.profileService.uploadProfilePicture(
        file.buffer,
        file.mimetype,
        file.originalname,
        new Types.ObjectId(adminId),
        new Types.ObjectId(projectId),
      );

      return {
        statusCode: HttpStatus.OK,
        message: 'Profile picture uploaded successfully',
        data: {
          fileHandle,
          fileName: file.originalname,
          fileSize: file.size,
          mimeType: file.mimetype,
        },
      };
    } catch (error) {
      throw new BadRequestException(
        `Failed to upload profile picture: ${error.message}`,
      );
    }
  }
}
