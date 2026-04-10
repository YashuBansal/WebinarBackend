import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotAcceptableException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, PipelineStage, Types } from 'mongoose';
import { Subscription } from 'src/schemas/Subscription.schema';
import { SubscriptionDto, UpdateSubscriptionDto } from './dto/subscription.dto';
import { AddOnService } from 'src/addon/addon.service';
import { BillingHistoryService } from 'src/billing-history/billing-history.service';
import { SubscriptionAddonService } from 'src/subscription-addon/subscription-addon.service';
import { PlansService } from 'src/plans/plans.service';
import { AttendeesService } from 'src/attendees/attendees.service';
import { UsersService } from 'src/users/users.service';
import { BillingType, DurationType } from 'src/schemas/BillingHistory.schema';
import { PlanDurationConfig, Plans } from 'src/schemas/Plans.schema';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SubscriptionService {
  GST_VALUE: number = 0;
  HEADER_LABEL: string | undefined = undefined;
  private readonly logger = new Logger(SubscriptionService.name);
  constructor(
    @InjectModel(Subscription.name)
    private SubscriptionModel: Model<Subscription>,
    @Inject(forwardRef(() => AddOnService))
    private readonly addOnService: AddOnService,
    @Inject(forwardRef(() => SubscriptionAddonService))
    private readonly subscriptionAddonService: SubscriptionAddonService,
    @Inject(forwardRef(() => AttendeesService))
    private readonly attendeesService: AttendeesService,
    @Inject(forwardRef(() => UsersService))
    private readonly userService: UsersService,
    private readonly BillingHistoryService: BillingHistoryService,
    @Inject(forwardRef(() => PlansService))
    private readonly plansService: PlansService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    const gstValueStr = this.configService.get<number>('GST_VALUE') || 0;
    const headerLabel =
      this.configService.get<string | undefined>('HEADER_LABEL') || undefined;

    const gstValue = parseInt(gstValueStr.toString());
    if (!isNaN(gstValue) && gstValue > 0) {
      this.GST_VALUE = gstValue;
    }
    this.HEADER_LABEL = headerLabel;
  }

  async addSubscription(subscriptionDto: SubscriptionDto): Promise<any> {
    const result = await this.SubscriptionModel.create(subscriptionDto);
    return result;
  }

  async updateSubscriptionContactCount() {
    const data = await this.attendeesService.getRemainingContacts();

    if (Array.isArray(data) && data.length > 0) {
      data.forEach(async (entry) => {
        this.logger.log(
          `Updating contact count${entry.counts} for admin ${entry._id}`,
        );
      });

      const operations = data.map((entry) => ({
        updateOne: {
          filter: { admin: entry._id },
          update: {
            $set: {
              contactCount: entry.counts ?? 0,
            },
          },
        },
      }));

      if (operations.length > 0) {
        const result = await this.SubscriptionModel.bulkWrite(operations, {
          ordered: false,
        });
        this.logger.log(`Updated ${result} contacts for admins`);
      }
    }
  }

  async getGSTValue() {
    return {
      GST_VALUE: this.GST_VALUE,
      HEADER_LABEL: this.HEADER_LABEL,
    };
  }

  async updateSubscriptionByPlanId({
    planId,
    data,
  }: {
    planId: string;
    data: {
      toggleLimit: number;
      contactLimit: number;
      employeeLimit: number;
      webinarLimit?: number;
      whatsappProjectLimit?: number;
      zoomProjectLimit?: number;
    };
  }): Promise<any> {
    const result = await this.SubscriptionModel.updateMany(
      { plan: new Types.ObjectId(planId) },
      { $set: data }, // Recommended: use $set when updating fields
    );
    return result;
  }

  async updateSubscription(
    id: string,
    updateSubscriptionDto: UpdateSubscriptionDto,
  ): Promise<any> {
    const result = await this.SubscriptionModel.findByIdAndUpdate(
      id,
      updateSubscriptionDto,
    );
    return result;
  }

  async getSubscription(adminId: string): Promise<Subscription> {
    const adminObjectId = new Types.ObjectId(adminId);

    const subscription = await this.SubscriptionModel.findOne({
      admin: adminObjectId,
    }).populate('plan');

    if (!subscription) {
      throw new NotFoundException('Subscription not found for the given admin');
    }

    // Backfill webinarLimit for legacy subscriptions that predate the field
    if (
      !subscription.webinarLimit &&
      subscription.webinarLimit !== 0 &&
      (subscription as any).plan &&
      typeof (subscription as any).plan.webinarLimit === 'number'
    ) {
      subscription.webinarLimit = (subscription as any).plan.webinarLimit;
      await subscription.save();
    }

    // Backfill project limits for legacy subscriptions that predate these fields.
    if (
      !subscription.whatsappProjectLimit &&
      subscription.whatsappProjectLimit !== 0 &&
      (subscription as any).plan &&
      typeof (subscription as any).plan.whatsappProjectLimit === 'number'
    ) {
      subscription.whatsappProjectLimit = (
        subscription as any
      ).plan.whatsappProjectLimit;
      await subscription.save();
    }

    if (
      !subscription.zoomProjectLimit &&
      subscription.zoomProjectLimit !== 0 &&
      (subscription as any).plan &&
      typeof (subscription as any).plan.zoomProjectLimit === 'number'
    ) {
      subscription.zoomProjectLimit = (
        subscription as any
      ).plan.zoomProjectLimit;
      await subscription.save();
    }

    // If there is no expiry date or it's invalid / in the past, deactivate the user
    if (!subscription.expiryDate) {
      await this.userService.deactivateUserByAdminId(adminObjectId);
      return subscription;
    }

    const expiryDate = new Date(subscription.expiryDate);

    if (isNaN(expiryDate.getTime()) || expiryDate.getTime() < Date.now()) {
      await this.userService.deactivateUserByAdminId(adminObjectId);
    }

    return subscription;
  }

  async updateSubscriptionExpiryDate(
    adminId: Types.ObjectId,
    expiryDate: Date,
  ): Promise<Subscription> {
    const updatedSubscription = await this.SubscriptionModel.findOneAndUpdate(
      { admin: adminId },
      { expiryDate },
      { new: true },
    );

    if (!updatedSubscription) {
      throw new BadRequestException('Subscription not found');
    }

    // If the expiryDate is in the past, deactivate the user
    if (new Date(expiryDate).getTime() < Date.now()) {
      await this.userService.deactivateUserByAdminId(adminId);
    }

    return updatedSubscription;
  }

  async updateWebinarLimitAddon(
    adminId: string,
    webinarLimitAddon: number,
  ): Promise<Subscription> {
    const adminObjectId = new Types.ObjectId(adminId);

    const updated = await this.SubscriptionModel.findOneAndUpdate(
      { admin: adminObjectId },
      { $set: { webinarLimitAddon } },
      { new: true },
    );

    if (!updated) {
      throw new BadRequestException('Subscription not found');
    }

    return updated;
  }

  async getUpcomingExpiry(): Promise<Subscription[]> {
    const today = new Date();
    const date15DaysLater = new Date();
    date15DaysLater.setDate(today.getDate() + 15);

    const startOfDay15DaysLater = new Date(
      date15DaysLater.setHours(0, 0, 0, 0),
    );

    const endOfDay15DaysLater = new Date(
      date15DaysLater.setHours(23, 59, 59, 999),
    );

    const result = await this.SubscriptionModel.find({
      expiryDate: { $gte: startOfDay15DaysLater, $lte: endOfDay15DaysLater },
    });

    return result;
  }

  async getExpiredSubscriptions(): Promise<Types.ObjectId[]> {
    const result = await this.SubscriptionModel.find({
      expiryDate: { $lt: new Date() },
    });
    return result.map((subscription) => subscription.admin);
  }

  async addAddonToSubscription(adminId: string, addonId: string) {
    const session = await this.SubscriptionModel.db.startSession();
    session.startTransaction();

    try {
      const addOn = await this.addOnService.getAddOnById(addonId);

      if (!addOn) {
        throw new NotFoundException('Addon not found');
      }

      const subscription = await this.SubscriptionModel.findOne({
        admin: new Types.ObjectId(`${adminId}`),
      }).session(session); // Use session for the query

      if (!subscription) {
        throw new NotFoundException(
          `Subscription with admin ID ${adminId} not found`,
        );
      }

      if (new Date() > subscription.expiryDate) {
        throw new NotFoundException('Subscription Expired');
      }

      const currentDate = new Date();
      const addOnExpiryFromValidity = new Date(
        currentDate.getTime() + addOn.validityInDays * 24 * 60 * 60 * 1000,
      );

      const addOnExpiry = subscription.expiryDate
        ? new Date(
            Math.min(
              addOnExpiryFromValidity.getTime(),
              subscription.expiryDate.getTime(),
            ),
          )
        : addOnExpiryFromValidity;

      const subscriptionAddon = await this.subscriptionAddonService
        .createSubscriptionAddon(
          subscription._id as string,
          addOnExpiry,
          addOn._id as string,
          undefined,
          addOn.employeeLimit,
          addOn.contactLimit,
          addOn.webinarLimit || 0,
          addOn.whatsappProjectLimit || 0,
          addOn.zoomProjectLimit || 0,
          {
            addonName: addOn.addonName,
            employeeLimit: addOn.employeeLimit,
            contactLimit: addOn.contactLimit,
            webinarLimit: addOn.webinarLimit || 0,
            whatsappProjectLimit: addOn.whatsappProjectLimit || 0,
            zoomProjectLimit: addOn.zoomProjectLimit || 0,
            addOnPrice: addOn.addOnPrice,
            validityInDays: addOn.validityInDays,
          },
          session,
        )
        .catch(() => {
          throw new Error('Failed to create subscription addon');
        });

      // Transaction-safe increment (legacy flow); daily recompute also corrects drift.
      await this.SubscriptionModel.updateOne(
        { _id: subscription._id },
        {
          $inc: {
            employeeLimitAddon: Math.max(addOn.employeeLimit, 0),
            contactLimitAddon: Math.max(addOn.contactLimit, 0),
            webinarLimitAddon: Math.max(addOn.webinarLimit || 0, 0),
            whatsappProjectLimitAddon: Math.max(
              addOn.whatsappProjectLimit || 0,
              0,
            ),
            zoomProjectLimitAddon: Math.max(addOn.zoomProjectLimit || 0, 0),
          },
        },
        { session },
      );
      await session.commitTransaction();
      session.endSession();
      const { itemAmount, taxAmount, totalAmount } = this.generatePriceForAddon(
        addOn.addOnPrice,
      );

      const billing = await this.BillingHistoryService.addOneBillingHistory(
        adminId,
        addonId,
        itemAmount,
        taxAmount,
        totalAmount,
        this.GST_VALUE,
        undefined,
        {
          startDate: subscriptionAddon?.startAt
            ? new Date(subscriptionAddon.startAt)
            : new Date(),
          expiryDate: subscriptionAddon?.expiryDate
            ? new Date(subscriptionAddon.expiryDate)
            : undefined,
        },
      ).catch(() => {
        throw new Error('Failed to create billing history');
      });

      return {
        subscription,
        billing,
        subscriptionAddon,
      };
    } catch (error) {
      // Rollback the transaction in case of an error
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }

  generatePriceForAddon(amount: number) {
    // Add-on price is GST-inclusive (same model as plans).
    const totalAmount = this.roundToTwoDecimals(amount);
    const taxAmount = this.roundToTwoDecimals(
      this.calculateInclusiveGST(totalAmount, this.GST_VALUE || 0),
    );
    const itemAmount = this.roundToTwoDecimals(totalAmount - taxAmount);
    return {
      itemAmount,
      taxAmount,
      totalAmount,
    };
  }

  async decrementSubscriptionAddons(
    employeeLimit: number,
    contactLimit: number,
    subscriptionId: Types.ObjectId,
    session: ClientSession,
  ): Promise<Subscription | null> {
    const result = await this.SubscriptionModel.findById(subscriptionId);
    if (!result) {
      return null;
    }

    // Ensure values do not go below 0
    result.employeeLimitAddon = Math.max(
      (result.employeeLimitAddon || 0) - employeeLimit,
      0,
    );
    result.contactLimitAddon = Math.max(
      (result.contactLimitAddon || 0) - contactLimit,
      0,
    );
    await result.save({ session });
    return result;
  }

  async updateClientPlan(
    adminIdOrEmail: string,
    planId: string,
    durationType: DurationType,
  ) {
    let adminId: string;
    if (adminIdOrEmail.includes('@')) {
      const normalizedEmail = adminIdOrEmail.trim().toLowerCase();
      const resolvedId =
        await this.userService.getAdminIdByEmail(normalizedEmail);
      if (!resolvedId) {
        throw new NotFoundException(
          `User not found for email ${normalizedEmail}`,
        );
      }
      adminId = resolvedId;
    } else {
      if (!Types.ObjectId.isValid(adminIdOrEmail)) {
        throw new BadRequestException('Invalid admin ID');
      }
      adminId = adminIdOrEmail;
    }

    const subscription = await this.SubscriptionModel.findOne({
      admin: new Types.ObjectId(`${adminId}`),
    });

    if (!subscription) {
      throw new NotFoundException(
        `Subscription with admin ID ${adminId} not found`,
      );
    }

    const isPlanExpired = new Date() > new Date(subscription.expiryDate);

    const usedContacts = await this.attendeesService.getDynamicAttendeeCount(
      new Types.ObjectId(`${adminId}`),
    );
    const usedEmployees = await this.userService.getEmployeesCount(adminId);

    const plan = await this.plansService.getPlan(planId);

    // if (plan.renewalNotAllowed) {
    //   throw new BadRequestException('Renewal not allowed');
    // }

    const isDurationConfig = plan.planDurationConfig.has(durationType);
    if (!isDurationConfig) {
      throw new NotFoundException('Duration type not found');
    }

    if (usedContacts > plan.contactLimit) {
      throw new BadRequestException('You cannot downgrade the plan');
    }

    if (usedEmployees > plan.employeeCount) {
      throw new BadRequestException('You cannot downgrade the plan');
    }

    const durationConfig = plan.planDurationConfig.get(durationType);
    if (!durationConfig.isEnabled) {
      throw new NotAcceptableException('Duration type is not enabled');
    }

    let billingStartDate = null;

    if (String(subscription.plan) === String(planId) && !isPlanExpired) {
      billingStartDate = subscription.expiryDate;

      subscription.expiryDate = new Date(
        subscription.expiryDate.getTime() +
          durationConfig.duration * 24 * 60 * 60 * 1000,
      );
    } else {
      billingStartDate = new Date();
      subscription.startDate = billingStartDate;
      subscription.expiryDate = new Date(
        Date.now() + durationConfig.duration * 24 * 60 * 60 * 1000,
      );
    }

    subscription.plan = new Types.ObjectId(`${planId}`);
    subscription.contactLimit = plan.contactLimit;
    subscription.employeeLimit = plan.employeeCount;
    subscription.toggleLimit = plan.toggleLimit;
    subscription.webinarLimit = plan.webinarLimit;
    subscription.whatsappProjectLimit = plan.whatsappProjectLimit || 0;
    subscription.zoomProjectLimit = plan.zoomProjectLimit || 0;

    const { totalWithGST, itemAmount, discountAmount, gst } =
      this.generatePriceForPlan(durationConfig);

    const billing = await this.BillingHistoryService.addBillingHistory(
      {
        admin: adminId,
        plan: planId,
        amount: totalWithGST,
        itemAmount: itemAmount,
        discountAmount: discountAmount,
        taxPercent: this.GST_VALUE,
        taxAmount: gst,
        durationType: durationType,
        startDate: billingStartDate,
        expiryDate: subscription.expiryDate,
      },
      BillingType.RENEWAL,
    );

    if (isPlanExpired)
      await this.userService.updateClient(adminId, { isActive: true });

    await subscription.save();

    const user = await this.userService.getUserById(adminId);
    if (user) {
      user.isActive = true;
      await user.save();
    }

    return { subscription, billing };
  }

  async incrementContactCount(id: string, count: number = 1) {
    const subscription = await this.SubscriptionModel.findById(id);
    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }
    subscription.contactCount = subscription.contactCount + count;
    await subscription.save();
    return subscription;
  }

  async updateContactCount(
    adminId: Types.ObjectId,
    count: number,
    session?: ClientSession,
  ) {
    return this.SubscriptionModel.updateOne(
      { admin: adminId },
      { $set: { contactCount: count } },
      { session },
    );
  }

  /**
   * Enterprise-grade price calculation with robust GST handling
   * Includes comprehensive validation, precision handling, and error management
   * GST is calculated as inclusive of the price
   */
  generatePriceForPlan(durationConfig: PlanDurationConfig): {
    totalWithGST: number;
    itemAmount: number;
    discountAmount: number;
    gst: number;
  } {
    // Input validation
    if (!durationConfig) {
      throw new Error('Duration configuration is required');
    }

    const { price, discountType, discountValue } = durationConfig;

    // Validate price
    if (typeof price !== 'number' || price < 0 || !isFinite(price)) {
      throw new Error('Invalid price: must be a non-negative finite number');
    }

    // Validate discount configuration
    if (!discountType || !['flat', 'percent'].includes(discountType)) {
      throw new Error('Invalid discount type: must be "flat" or "percent"');
    }

    if (
      typeof discountValue !== 'number' ||
      discountValue < 0 ||
      !isFinite(discountValue)
    ) {
      throw new Error(
        'Invalid discount value: must be a non-negative finite number',
      );
    }

    // Handle GST configuration - treat undefined, null, or 0 as 0
    const gstValue = this.GST_VALUE || 0;
    if (typeof gstValue !== 'number' || gstValue < 0 || gstValue > 100) {
      throw new Error('Invalid GST value: must be between 0 and 100');
    }

    // Calculate discount amount with precision handling
    let discountAmount: number;
    if (discountType === 'flat') {
      discountAmount = Math.min(discountValue, price); // Ensure discount doesn't exceed price
    } else {
      // Percentage discount - ensure it doesn't exceed 100%
      const cappedDiscountValue = Math.min(discountValue, 100);
      discountAmount = Math.min((price * cappedDiscountValue) / 100, price);
    }

    // Calculate price after discount
    const priceAfterDiscount = Math.max(price - discountAmount, 0); // Ensure non-negative

    // Calculate inclusive GST from the price after discount
    // Formula: GST = (Price * GST_RATE) / (100 + GST_RATE)
    const gst = this.calculateInclusiveGST(priceAfterDiscount, gstValue);

    // Calculate item amount (price without GST)
    const itemAmount = this.roundToTwoDecimals(priceAfterDiscount - gst);

    // Total with GST is the original price after discount
    const totalWithGST = this.roundToTwoDecimals(priceAfterDiscount);

    return {
      totalWithGST,
      itemAmount,
      discountAmount: this.roundToTwoDecimals(discountAmount),
      gst: this.roundToTwoDecimals(gst),
    };
  }

  /**
   * Calculate inclusive GST with proper precision handling
   * Formula: GST = (Price * GST_RATE) / (100 + GST_RATE)
   * Handles undefined, null, or 0 GST values
   */
  private calculateInclusiveGST(price: number, gstPercentage: number): number {
    // Handle undefined, null, or 0 GST values
    const gstValue = gstPercentage || 0;
    if (gstValue === 0) return 0;

    // Use integer arithmetic to avoid floating point precision issues
    const priceInCents = Math.round(price * 100);
    const gstInCents = Math.round((priceInCents * gstValue) / (100 + gstValue));
    return gstInCents / 100;
  }

  /**
   * Round to two decimal places using proper rounding method
   */
  private roundToTwoDecimals(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  async getPlanSubscriptionCount(): Promise<
    { _id: string; subscriptionCount: number }[]
  > {
    const pipeline: PipelineStage[] = [
      {
        $group: {
          _id: '$plan',
          subscriptionCount: {
            $sum: 1,
          },
        },
      },
    ];
    const result = await this.SubscriptionModel.aggregate(pipeline).exec();
    return result;
  }

  async updateSubscriptionAddons() {
    await this.subscriptionAddonService.markExpiredAddons();
    return this.updateSubscriptionAddonsForSubscriptions();
  }

  private buildSubscriptionAddonRecountPipeline(
    now: Date,
    subscriptionIds?: string[],
  ): PipelineStage[] {
    const pipeline: PipelineStage[] = [];
    if (Array.isArray(subscriptionIds) && subscriptionIds.length > 0) {
      const objectIds = subscriptionIds
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id));
      if (objectIds.length === 0) {
        return [];
      }
      pipeline.push({
        $match: {
          _id: { $in: objectIds },
        },
      });
    }

    pipeline.push(
      {
        $lookup: {
          from: 'subscriptionaddons',
          let: { subscriptionId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$subscription', '$$subscriptionId'] },
                    { $eq: ['$status', 'ACTIVE'] },
                    { $gt: ['$expiryDate', now] },
                  ],
                },
              },
            },
          ],
          as: 'addonDetails',
        },
      },
      {
        $match: {
          $or: [
            { addonDetails: { $ne: [] } },
            { employeeLimitAddon: { $gt: 0 } },
            { contactLimitAddon: { $gt: 0 } },
            { webinarLimitAddon: { $gt: 0 } },
            { whatsappProjectLimitAddon: { $gt: 0 } },
            { zoomProjectLimitAddon: { $gt: 0 } },
          ],
        },
      },
      {
        $addFields: {
          totalEmployeeLimitAddon: {
            $sum: {
              $map: {
                input: '$addonDetails',
                as: 'addon',
                in: { $ifNull: ['$$addon.employeeLimit', 0] },
              },
            },
          },
          totalContactLimitAddon: {
            $sum: {
              $map: {
                input: '$addonDetails',
                as: 'addon',
                in: { $ifNull: ['$$addon.contactLimit', 0] },
              },
            },
          },
          totalWebinarLimitAddon: {
            $sum: {
              $map: {
                input: '$addonDetails',
                as: 'addon',
                in: { $ifNull: ['$$addon.webinarLimit', 0] },
              },
            },
          },
          totalWhatsappProjectLimitAddon: {
            $sum: {
              $map: {
                input: '$addonDetails',
                as: 'addon',
                in: { $ifNull: ['$$addon.whatsappProjectLimit', 0] },
              },
            },
          },
          totalZoomProjectLimitAddon: {
            $sum: {
              $map: {
                input: '$addonDetails',
                as: 'addon',
                in: { $ifNull: ['$$addon.zoomProjectLimit', 0] },
              },
            },
          },
        },
      },
      {
        $project: {
          addonDetails: 0,
        },
      },
      {
        $match: {
          $or: [
            {
              $expr: {
                $ne: ['$employeeLimitAddon', '$totalEmployeeLimitAddon'],
              },
            },
            {
              $expr: { $ne: ['$contactLimitAddon', '$totalContactLimitAddon'] },
            },
            {
              $expr: { $ne: ['$webinarLimitAddon', '$totalWebinarLimitAddon'] },
            },
            {
              $expr: {
                $ne: [
                  '$whatsappProjectLimitAddon',
                  '$totalWhatsappProjectLimitAddon',
                ],
              },
            },
            {
              $expr: {
                $ne: ['$zoomProjectLimitAddon', '$totalZoomProjectLimitAddon'],
              },
            },
          ],
        },
      },
      {
        $set: {
          employeeLimitAddon: { $ifNull: ['$totalEmployeeLimitAddon', 0] },
          contactLimitAddon: { $ifNull: ['$totalContactLimitAddon', 0] },
          webinarLimitAddon: { $ifNull: ['$totalWebinarLimitAddon', 0] },
          whatsappProjectLimitAddon: {
            $ifNull: ['$totalWhatsappProjectLimitAddon', 0],
          },
          zoomProjectLimitAddon: {
            $ifNull: ['$totalZoomProjectLimitAddon', 0],
          },
        },
      },
      {
        $unset: [
          'totalEmployeeLimitAddon',
          'totalContactLimitAddon',
          'totalWebinarLimitAddon',
          'totalWhatsappProjectLimitAddon',
          'totalZoomProjectLimitAddon',
        ],
      },
      {
        $merge: {
          into: 'subscriptions',
          on: '_id',
          whenMatched: 'merge',
          whenNotMatched: 'discard',
        },
      },
    );

    return pipeline;
  }

  async updateSubscriptionAddonsForSubscriptions(subscriptionIds?: string[]) {
    if (Array.isArray(subscriptionIds) && subscriptionIds.length === 0) {
      return [];
    }
    const now = new Date();
    const pipeline = this.buildSubscriptionAddonRecountPipeline(
      now,
      subscriptionIds,
    );
    if (pipeline.length === 0) {
      return [];
    }
    return this.SubscriptionModel.aggregate(pipeline).exec();
  }

  async expireAndRecomputeAffectedSubscriptionAddons() {
    const affectedSubscriptionIds =
      await this.subscriptionAddonService.markExpiredAddonsAndGetAffectedSubscriptions();
    if (!affectedSubscriptionIds.length) {
      return [];
    }
    return this.updateSubscriptionAddonsForSubscriptions(
      affectedSubscriptionIds,
    );
  }

  async updateSingleSubscriptionAddon(subscriptionId: string) {
    const subscription = await this.SubscriptionModel.findById(subscriptionId);
    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }
    await this.subscriptionAddonService.markExpiredAddons();
    const now = new Date();

    const pipeline: PipelineStage[] = [
      {
        $match: {
          _id: new Types.ObjectId(`${subscriptionId}`),
        },
      },
      {
        $lookup: {
          from: 'subscriptionaddons',
          let: { subscriptionId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$subscription', '$$subscriptionId'] },
                    { $eq: ['$status', 'ACTIVE'] },
                    { $gt: ['$expiryDate', now] },
                  ],
                },
              },
            },
          ],
          as: 'addonDetails',
        },
      },
      {
        $project: {
          totalEmployeeLimitAddon: {
            $sum: {
              $map: {
                input: '$addonDetails',
                as: 'addon',
                in: { $ifNull: ['$$addon.employeeLimit', 0] },
              },
            },
          },
          totalContactLimitAddon: {
            $sum: {
              $map: {
                input: '$addonDetails',
                as: 'addon',
                in: { $ifNull: ['$$addon.contactLimit', 0] },
              },
            },
          },
          totalWebinarLimitAddon: {
            $sum: {
              $map: {
                input: '$addonDetails',
                as: 'addon',
                in: { $ifNull: ['$$addon.webinarLimit', 0] },
              },
            },
          },
          totalWhatsappProjectLimitAddon: {
            $sum: {
              $map: {
                input: '$addonDetails',
                as: 'addon',
                in: { $ifNull: ['$$addon.whatsappProjectLimit', 0] },
              },
            },
          },
          totalZoomProjectLimitAddon: {
            $sum: {
              $map: {
                input: '$addonDetails',
                as: 'addon',
                in: { $ifNull: ['$$addon.zoomProjectLimit', 0] },
              },
            },
          },
        },
      },
    ];

    const result = await this.SubscriptionModel.aggregate(pipeline).exec();
    if (result && result.length === 0) {
      subscription.employeeLimitAddon = 0;
      subscription.contactLimitAddon = 0;
      subscription.webinarLimitAddon = 0;
      subscription.whatsappProjectLimitAddon = 0;
      subscription.zoomProjectLimitAddon = 0;
      await subscription.save();
      return [];
    } else {
      subscription.employeeLimitAddon = result[0].totalEmployeeLimitAddon;
      subscription.contactLimitAddon = result[0].totalContactLimitAddon;
      subscription.webinarLimitAddon = result[0].totalWebinarLimitAddon || 0;
      subscription.whatsappProjectLimitAddon =
        result[0].totalWhatsappProjectLimitAddon || 0;
      subscription.zoomProjectLimitAddon =
        result[0].totalZoomProjectLimitAddon || 0;
      await subscription.save();
    }
    return result;
  }

  async revalidateUsedContactCounts() {
    const pipeline: PipelineStage[] = [
      {
        $lookup: {
          from: 'attendees',
          let: { adminId: '$admin' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: ['$adminId', '$$adminId'],
                },
              },
            },
            {
              $group: {
                _id: '$email',
              },
            },
            {
              $count: 'total',
            },
          ],
          as: 'attendeeCount',
        },
      },
      {
        $unwind: {
          path: '$attendeeCount',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $set: {
          contactCount: {
            $ifNull: ['$attendeeCount.total', 0],
          },
        },
      },
      {
        $project: {
          attendeeCount: 0,
        },
      },
      {
        $merge: {
          into: 'subscriptions',
          on: '_id',
          whenMatched: 'merge',
          whenNotMatched: 'discard',
        },
      },
    ];

    return this.SubscriptionModel.aggregate(pipeline).exec();
  }

  async revalidateUsedContactCountsOfAdmin(adminId: Types.ObjectId) {
    const usedContacts = await this.attendeesService.getNonUniqueAttendeesCount(
      [],
      adminId,
    );

    return this.updateContactCount(adminId, usedContacts);
  }

  async validateUserEligibility(
    adminId: string,
    planId: string,
    durationType: DurationType,
  ): Promise<{ isEligible: boolean; totalWithGST: number; planData: Plans }> {
    const subscription = await this.getSubscription(adminId);

    if (!subscription) {
      throw new NotFoundException(
        `Subscription with admin ID ${adminId} not found`,
      );
    }

    const usedContacts = await this.attendeesService.getNonUniqueAttendeesCount(
      [],
      new Types.ObjectId(`${adminId}`),
    );
    const usedEmployees = await this.userService.getEmployeesCount(adminId);

    const plan = await this.plansService.getPlan(planId);

    const isDurationConfig = plan.planDurationConfig.has(durationType);
    if (!isDurationConfig) {
      throw new NotFoundException('Duration type not found');
    }

    if (usedContacts > plan.contactLimit) {
      throw new BadRequestException('You cannot downgrade the plan');
    }

    if (usedEmployees > plan.employeeCount) {
      throw new BadRequestException('You cannot downgrade the plan');
    }

    const durationConfig = plan.planDurationConfig.get(durationType);
    if (!durationConfig)
      throw new NotAcceptableException('Duration type not found.');

    if (!durationConfig.isEnabled) {
      throw new NotAcceptableException('Duration type is not enabled');
    }

    const { totalWithGST } = this.generatePriceForPlan(durationConfig);

    return { isEligible: true, totalWithGST, planData: plan };
  }
}
