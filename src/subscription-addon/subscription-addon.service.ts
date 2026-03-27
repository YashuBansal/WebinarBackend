import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  SubscriptionAddOn,
  UserAddonStatus,
} from 'src/schemas/SubscriptionAddon.schema';

@Injectable()
export class SubscriptionAddonService {
  constructor(
    @InjectModel(SubscriptionAddOn.name)
    private SubscriptionAddOnModel: Model<SubscriptionAddOn>,
  ) {}

  async createSubscriptionAddon(
    subscriptionId: string,
    expiryDate: Date,
    addOnId: string,
    purchaseId?: string,
    employeeLimit: number = 0,
    contactLimit: number = 0,
    webinarLimit: number = 0,
    whatsappProjectLimit: number = 0,
    zoomProjectLimit: number = 0,
    benefitsSnapshot?: SubscriptionAddOn['benefitsSnapshot'],
    session?: ClientSession,
  ): Promise<SubscriptionAddOn> {
    const subscriptionAddon = new this.SubscriptionAddOnModel({
      subscription: new Types.ObjectId(`${subscriptionId}`),
      expiryDate,
      addOn: new Types.ObjectId(`${addOnId}`),
      purchase: purchaseId ? new Types.ObjectId(`${purchaseId}`) : undefined,
      status: UserAddonStatus.ACTIVE,
      employeeLimit,
      contactLimit,
      webinarLimit,
      whatsappProjectLimit,
      zoomProjectLimit,
      benefitsSnapshot,
    });
    return subscriptionAddon.save({ session });
  }

  async markExpiredAddons(now: Date = new Date(), session?: ClientSession) {
    return this.SubscriptionAddOnModel.updateMany(
      {
        status: UserAddonStatus.ACTIVE,
        expiryDate: { $lte: now },
      },
      { $set: { status: UserAddonStatus.EXPIRED } },
      { session },
    );
  }

  async markExpiredAddonsAndGetAffectedSubscriptions(
    now: Date = new Date(),
    session?: ClientSession,
  ): Promise<string[]> {
    const expiredActiveAddons = await this.SubscriptionAddOnModel.find(
      {
        status: UserAddonStatus.ACTIVE,
        expiryDate: { $lte: now },
      },
      { subscription: 1 },
      { session },
    ).lean();

    if (!expiredActiveAddons.length) {
      return [];
    }

    const affectedSubscriptionIds = Array.from(
      new Set(
        expiredActiveAddons
          .map((entry) => entry.subscription?.toString())
          .filter((id): id is string => Boolean(id)),
      ),
    );

    await this.SubscriptionAddOnModel.updateMany(
      {
        status: UserAddonStatus.ACTIVE,
        expiryDate: { $lte: now },
      },
      { $set: { status: UserAddonStatus.EXPIRED } },
      { session },
    );

    return affectedSubscriptionIds;
  }

  async getUserAddons(subscriptionId: string) {
    return await this.SubscriptionAddOnModel.aggregate([
      {
        $match: {
          subscription: new Types.ObjectId(`${subscriptionId}`),
        },
      },
      {
        $lookup: {
          from: 'addons',
          localField: 'addOn',
          foreignField: '_id',
          as: 'addOnDetails',
        },
      },
      {
        $unwind: {
          path: '$addOnDetails',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          addonName: { $ifNull: ['$benefitsSnapshot.addonName', '$addOnDetails.addonName'] },
          expiryDate: '$expiryDate',
          employeeLimit: { $ifNull: ['$benefitsSnapshot.employeeLimit', '$addOnDetails.employeeLimit'] },
          contactLimit: { $ifNull: ['$benefitsSnapshot.contactLimit', '$addOnDetails.contactLimit'] },
          webinarLimit: { $ifNull: ['$benefitsSnapshot.webinarLimit', '$addOnDetails.webinarLimit'] },
          whatsappProjectLimit: {
            $ifNull: [
              '$benefitsSnapshot.whatsappProjectLimit',
              '$addOnDetails.whatsappProjectLimit',
            ],
          },
          zoomProjectLimit: {
            $ifNull: [
              '$benefitsSnapshot.zoomProjectLimit',
              '$addOnDetails.zoomProjectLimit',
            ],
          },
          addOnPrice: { $ifNull: ['$benefitsSnapshot.addOnPrice', '$addOnDetails.addOnPrice'] },
          addOnId: '$addOn',
          status: '$status',
        },
      },
    ]).exec();
  }

  async getUserAddonByPurchaseId(purchaseId: string) {
    if (!Types.ObjectId.isValid(purchaseId)) return null;
    return this.SubscriptionAddOnModel.findOne(
      { purchase: new Types.ObjectId(purchaseId) },
      { startAt: 1, expiryDate: 1 },
    )
      .lean()
      .exec();
  }
}
