import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Plans, PlanType } from './Plans.schema';
import { CreatePlansDto, PlanOrderDTO } from './dto/createPlans.dto';
import { UpdatePlansDto } from './dto/updatePlans.dto';
import { SubscriptionService } from 'src/subscription/subscription.service';

@Injectable()
export class PlansService {
  constructor(
    @InjectModel(Plans.name) private plansModel: Model<Plans>,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => SubscriptionService))
    private readonly subscriptionService: SubscriptionService,
  ) {}

  async getPlan(id: string): Promise<Plans> {
    const plans = await this.plansModel.findById(id);

    if (!plans) {
      throw new NotFoundException('No Plan found.');
    }

    return plans;
  }

  async getPlans(
    userId: Types.ObjectId,
    role: string,
    isActive: boolean = true,
  ): Promise<any> {
    let query = {};
    let planSubscriptionCount = [];

    if (role !== this.configService.get('appRoles')['SUPER_ADMIN']) {
      const subscription = await this.subscriptionService.getSubscription(
        userId.toString(),
      );
      if (!subscription) {
        throw new NotFoundException('No Subscription found.');
      }

      query = {
        $or: [
          { planType: PlanType.NORMAL, isActive: true },
          { assignedUsers: userId, isActive: true },
          { _id: subscription.plan },
        ],
      };
    } else {
      query = { isActive };
      planSubscriptionCount =
        await this.subscriptionService.getPlanSubscriptionCount();
    }
    const plans = await this.plansModel
      .find(query)
      .sort({ sortOrder: 1 })
      .lean();

    if (planSubscriptionCount.length === 0) {
      return plans;
    }
    return plans.map((plan) => {
      const subscriptionCount = planSubscriptionCount.find(
        (count) => String(count._id) === String(plan._id),
      );
      return {
        ...plan,
        subscriptionCount: subscriptionCount?.subscriptionCount || 0,
      };
    });
  }

  async addPlan(createPlanDto: CreatePlansDto): Promise<any> {
    const existingPlan = await this.plansModel.findOne({
      internalName: createPlanDto.internalName,
    });

    if (existingPlan) {
      throw new BadRequestException(
        'A plan with the same Internal Name already exists.',
      );
    }

    if (createPlanDto.isDefaultSignupPlan === true) {
      await this.plansModel.updateMany({}, { $set: { isDefaultSignupPlan: false } });
    }

    // Create the new plan
    const plan = new this.plansModel(createPlanDto);
    try {
      return await plan.save();
    } catch (error) {
      throw new BadRequestException(`Failed to create plan: ${error.message}`);
    }
  }

  async updatePlan(id: string, updatePlanDto: UpdatePlansDto): Promise<any> {
    if (updatePlanDto.isDefaultSignupPlan === true) {
      await this.plansModel.updateMany(
        { _id: { $ne: new Types.ObjectId(id) } },
        { $set: { isDefaultSignupPlan: false } },
      );
    }

    // Update the plan
    const plan = await this.plansModel.findByIdAndUpdate(id, updatePlanDto, {
      new: true,
    });
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    await this.subscriptionService.updateSubscriptionByPlanId({
      planId: id,
      data: {
        toggleLimit: updatePlanDto.toggleLimit,
        contactLimit: updatePlanDto.contactLimit,
        employeeLimit: updatePlanDto.employeeCount,
        webinarLimit: updatePlanDto.webinarLimit,
        whatsappProjectLimit: updatePlanDto.whatsappProjectLimit,
        zoomProjectLimit: updatePlanDto.zoomProjectLimit,
      },
    });
    return plan;
  }

  async inactivePlan(id: string, isActive: boolean): Promise<any> {
    const plan = await this.plansModel.findByIdAndUpdate(id, {
      isActive,
    });
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    return plan;
  }

  async updatePlansOrder(data: PlanOrderDTO): Promise<any> {
    const { plans } = data;

    const ids = plans.map((plan) => plan.id);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Duplicate IDs in the input data.');
    }

    const updatePromises = plans.map(async (plan) => {
      return this.plansModel.updateOne(
        { _id: plan.id },
        { $set: { sortOrder: plan.sortOrder } },
      );
    });

    await Promise.all(updatePromises);

    return {
      message: 'Plans order updated successfully.',
      updatedPlans: plans,
    };
  }

  async getPlansForDropdown() {
    const plans = await this.plansModel
      .find()
      .sort({ sortOrder: 1 })
      .select('name _id')
      .lean();
    return plans.map((plan) => ({
      label: plan.name,
      value: plan._id,
    }));
  }

  async getExternalPlanURI(): Promise<string> {
    const externalPlanURI = this.configService.get('EXTERNAL_PLAN_URI');

    return externalPlanURI || '/';
  }
}
