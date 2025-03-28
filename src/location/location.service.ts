import { Injectable, NotAcceptableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateLocationDto, UpdateLocationDto } from './dto/location.dto';
import { Location } from 'src/schemas/location.schema';
import { NotificationService } from 'src/notification/notification.service';
import {
  notificationActionType,
  notificationType,
} from 'src/schemas/notification.schema';

@Injectable()
export class LocationService {
  constructor(
    @InjectModel(Location.name) private readonly locationModel: Model<Location>,
    private readonly notificationService: NotificationService,
  ) {}

  async addLocation(createLocationDto: CreateLocationDto): Promise<any> {
    const isExisting = await this.locationModel.findOne({
      name: createLocationDto.name,
    });
    if (isExisting)
      throw new NotAcceptableException(
        'Location or request to add it already exists, Kindly contact administrator to know more about this issue.',
      );

    const result = await this.locationModel.create(createLocationDto);
    return result;
  }

  async getLocations(page: number, limit: number): Promise<any> {

    if(limit === 0) {
      const result = await this.locationModel.find({ isVerified: true, deactivated: false }).select('name');
      return {
        data: result,
      };
    }

    const skip = (page - 1) * limit;

    const pipeline = [
      {
        $match: { isVerified: true, deactivated: false },
      },
      {
        $skip: skip,
      },
      {
        $limit: limit,
      },
      {
        $lookup: {
          from: 'users',
          localField: 'admin',
          foreignField: '_id',
          as: 'adminData',
        },
      },
      {
        $unwind: {
          path: '$adminData',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $addFields: {
          admin: '$adminData._id',
          adminEmail: '$adminData.email',
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'employee',
          foreignField: '_id',
          as: 'employeeData',
        },
      },
      {
        $unwind: {
          path: '$employeeData',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $addFields: {
          employee: '$employeeData._id',
          employeeEmail: '$employeeData.email',
        },
      },
      {
        $project: {
          adminData: 0,
          employeeData: 0,
        },
      },
    ];


    const [result, total] = await Promise.all([
      this.locationModel.aggregate(pipeline),
      this.locationModel.countDocuments({ isVerified: true, deactivated: false }),
    ]);

    return {
      data: result,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getLocationRequests(
    page: number,
    limit: number,
    isVerified: boolean,
    admin?: string,
    isAdminVerified?: boolean,
  ): Promise<any> {
    const query = { isVerified };
    if (admin) {
      query['admin'] = new Types.ObjectId(`${admin}`);
    }
    if (isAdminVerified) {
      query['isAdminVerified'] = isAdminVerified;
    }

    const skip = (page - 1) * limit;

    const pipeline = [
      {
        $match: query,
      },
      {
        $skip: skip,
      },
      {
        $limit: limit,
      },
      {
        $lookup: {
          from: 'users',
          localField: 'admin',
          foreignField: '_id',
          as: 'adminData',
        },
      },
      {
        $unwind: {
          path: '$adminData',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $addFields: {
          admin: '$adminData._id',
          adminEmail: '$adminData.email',
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'employee',
          foreignField: '_id',
          as: 'employeeData',
        },
      },
      {
        $unwind: {
          path: '$employeeData',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $addFields: {
          employee: '$employeeData._id',
          employeeEmail: '$employeeData.email',
        },
      },
      {
        $project: {
          adminData: 0,
          employeeData: 0,
        },
      },
    ];

    const [result, total] = await Promise.all([
      this.locationModel.aggregate(pipeline),
      this.locationModel.countDocuments(query),
    ]);

    return {
      data: result,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async approveRequest(
    id: string,
    updateLocationDto: UpdateLocationDto,
  ): Promise<any> {
    const result = await this.locationModel.findOneAndUpdate(
      { _id: new Types.ObjectId(`${id}`), deactivated: false },
      updateLocationDto,
      { new: true },
    );

    //notification to admin and employee

    if (result?.admin) {
      await this.notificationService.createNotification({
        recipient: result.admin.toString(),
        title: 'Location request approved.',
        message: `Your request to add location ${result?.name} has been approved.`,
        type: notificationType.INFO,
        actionType: notificationActionType.LOCATION_REQUEST,
      });
    }

    if (result?.employee) {
      await this.notificationService.createNotification({
        recipient: result?.admin.toString(),
        title: 'Location request approved.',
        message: `Your request to add location ${result?.name} has been approved.`,
        type: notificationType.INFO,
        actionType: notificationActionType.LOCATION_REQUEST,
      });
    }

    return result;
  }

  async disapproveRequest(
    id: string,
    updateLocationDto: UpdateLocationDto,
  ): Promise<any> {
    const result = await this.locationModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(`${id}`),
      },
      { deactivated: true, ...updateLocationDto },
      { new: true },
    );

    if (result?.admin) {
      await this.notificationService.createNotification({
        recipient: result.admin.toString(),
        title: 'Location request rejected.',
        message: `Your request to add location ${result?.name} has been rejected.`,
        type: notificationType.INFO,
        actionType: notificationActionType.LOCATION_REQUEST,
      });
    }

    if (result?.employee) {
      await this.notificationService.createNotification({
        recipient: result?.admin.toString(),
        title: 'Location request rejected.',
        message: `Your request to add location ${result?.name} has been rejected.`,
        type: notificationType.INFO,
        actionType: notificationActionType.LOCATION_REQUEST,
      });
    }

    return result;
  }
}
