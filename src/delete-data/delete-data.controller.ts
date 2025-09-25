import { Controller, Delete, Param } from '@nestjs/common';

import { DeleteDataService } from './delete-data.service';
import mongoose, { Types } from 'mongoose';

@Controller('delete-data')
export class DeleteDataController {
  constructor(private readonly deleteDataService: DeleteDataService) {}
  //   @Delete()
  //   async deleteData(@Id() id: string): Promise<any> {
  //     const result = await this.deleteDataService.deleteData(id);
  //     return result;
  //   }

  @Delete(':id')
  async deleteClientData(@Param('id') id: string): Promise<any> {
    if (mongoose.isValidObjectId(id)) {
      const result = await this.deleteDataService.deleteDataByAdminId(
        new Types.ObjectId(id),
      );
      return result;
    }
  }
}
