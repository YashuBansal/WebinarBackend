// src/file-storage/file-storage.service.ts
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

@Injectable()
export class FileStorageService {
  private readonly logger = new Logger(FileStorageService.name);
  private readonly uploadPath = join(process.cwd(), 'uploads');
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    // It's crucial to use environment variables for your base URL.
    this.baseUrl = this.configService.get<string>('API_BASE_URL'); // e.g., https://api.saasapplication.com
    if (!this.baseUrl) {
      throw new Error('API_BASE_URL environment variable is not set.');
    }
    this.ensureUploadDirectoryExists();
  }

  private async ensureUploadDirectoryExists() {
    try {
      await fs.mkdir(this.uploadPath, { recursive: true });
    } catch (error) {
      this.logger.error('Error creating upload directory', error);
      throw new InternalServerErrorException('Could not initialize storage.');
    }
  }

  async saveFile(
    file: Express.Multer.File,
    subfolder: string,
  ): Promise<{ publicUrl: string; filePath: string }> {
    try {
      const fileExtension = file.originalname.split('.').pop();
      const uniqueFileName = `${randomUUID()}.${fileExtension}`;

      const destinationFolder = join(this.uploadPath, subfolder);
      const filePath = join(destinationFolder, uniqueFileName);

      // Ensure the subfolder exists
      await fs.mkdir(destinationFolder, { recursive: true });

      // Write the file to the disk
      await fs.writeFile(filePath, file.buffer);

      // Construct the public URL
      // Note: We use forward slashes for URLs regardless of the OS
      const publicUrl = `${this.baseUrl}/uploads/${subfolder}/${uniqueFileName}`;

      return { publicUrl, filePath };
    } catch (error) {
      this.logger.error(`Failed to save file: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to save file.');
    }
  }
}
