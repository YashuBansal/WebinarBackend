import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotAcceptableException,
  NotFoundException,
} from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { ClientSession, Model, PipelineStage, Types } from 'mongoose';
import { User } from 'src/schemas/User.schema';
import { ConfigService } from '@nestjs/config';
import { CreateEmployeeDto } from 'src/auth/dto/createEmployee.dto';
import { CreatorDetailsDto } from 'src/auth/dto/creatorDetails.dto';
import { CreateClientDto } from 'src/auth/dto/createClient.dto';
import { BillingHistoryService } from 'src/billing-history/billing-history.service';
import { SubscriptionService } from 'src/subscription/subscription.service';
import { SubscriptionDto } from 'src/subscription/dto/subscription.dto';
import { UpdateUserInfoDto } from './dto/update-user.dto';
import * as bcrypt from 'bcrypt';
import { UpdatePasswordDto } from './dto/updatePassword.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { JwtService } from '@nestjs/jwt';
import { GetClientsFilterDto } from './dto/filters.dto';
import { EmployeeFilterDTO } from './dto/employee-filter.dto';
import { CustomLeadTypeService } from 'src/custom-lead-type/custom-lead-type.service';
import { NotificationService } from 'src/notification/notification.service';
import {
  notificationActionType,
  notificationType,
} from 'src/schemas/notification.schema';
import { BillingType } from 'src/schemas/BillingHistory.schema';
import { ProductsService } from 'src/products/products.service';
import { WebsocketGateway } from 'src/websocket/websocket.gateway';
import { TwoFactorAuthenticationService } from 'src/two-factor-authentication/two-factor-authentication.service';
import { ApiAccessTokenService } from 'src/api-access-token/api-access-token.service';
import { SocketEvents } from 'src/websocket/dto/socket.dto';
import { RolesService } from 'src/roles/roles.service';
import { PlansService } from 'src/plans/plans.service';
import { CachedUserRecord, UserCacheService } from './user-cache.service';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    private readonly rolesService: RolesService,
    @Inject(forwardRef(() => PlansService))
    private readonly plansService: PlansService,
    private configService: ConfigService,
    private readonly billingHistoryService: BillingHistoryService,
    @Inject(forwardRef(() => SubscriptionService))
    private readonly subscriptionService: SubscriptionService,
    private readonly jwtService: JwtService,
    @Inject(forwardRef(() => CustomLeadTypeService))
    private readonly customLeadTypeService: CustomLeadTypeService,
    private readonly productsService: ProductsService,
    private readonly notificationService: NotificationService,
    private readonly socketGateway: WebsocketGateway,
    private readonly twofaService: TwoFactorAuthenticationService,
    private readonly apiTokenService: ApiAccessTokenService,
    private readonly userCacheService: UserCacheService,
  ) {}

  async getUserSubscription(userId: string) {
    return this.subscriptionService.getSubscription(userId);
  }

  getUsers() {
    return this.userModel.find();
  }

  async setTwoFactorAuthenticationSecret(
    secret: string,
    userId: Types.ObjectId,
  ) {
    return this.userModel
      .updateOne(
        { _id: userId },
        {
          twoFactorAuthenticationSecret: secret,
        },
      )
      .exec();
  }

  async toggle2FA(userId: Types.ObjectId) {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User Not Found');
    }
    if (user.isTwoFactorAuthenticationEnabled) {
      user.twoFactorAuthenticationSecret = null;
    }

    user.isTwoFactorAuthenticationEnabled =
      !user.isTwoFactorAuthenticationEnabled;
    user.save();
  }

  async turnOffTwoFactorAuthentication(userId: Types.ObjectId) {
    return this.userModel
      .updateOne(
        { _id: userId },
        {
          isTwoFactorAuthenticationEnabled: false,
          twoFactorAuthenticationSecret: null,
        },
      )
      .exec();
  }

  async generate2faToken(id: string) {
    const user = await this.userModel.findById(id);

    if (!user) {
      throw new NotFoundException('User Not Found');
    }
    const { secret } =
      await this.twofaService.generateTwoFactorAuthenticationSecret(user);
    await this.setTwoFactorAuthenticationSecret(
      secret,
      user._id as Types.ObjectId,
    );

    return { secret };
  }

  async start2faAuthentication(
    id: string,
    twoFactorAuthenticationCode: string,
  ) {
    const user = await this.userModel.findById(id);
    const isCodeValid =
      await this.twofaService.isTwoFactorAuthenticationCodeValid(
        twoFactorAuthenticationCode,
        user,
      );

    if (!isCodeValid) {
      throw new BadRequestException('Wrong authentication code');
    }

    await this.toggle2FA(user._id as Types.ObjectId);
    return { message: '2FA has been enabled successfully.' };
  }

  createUser(createUserDto: CreateUserDto) {
    const newUser = new this.userModel(createUserDto);
    return newUser.save();
  }

  createClientPipeline(
    filterData: GetClientsFilterDto,
    hasFilters: boolean = true,
    skip: number,
    limit: number,
  ): {
    pipeline: mongoose.PipelineStage[];
    initialPipeline: mongoose.PipelineStage[];
  } {
    const matchFilters: Record<string, any> = {};
    if (filterData.email)
      matchFilters['email'] = { $regex: filterData.email.toLowerCase() };
    if (filterData.companyName)
      matchFilters['companyName'] = {
        $regex: filterData.companyName,
        $options: 'i',
      };
    if (filterData.userName)
      matchFilters['userName'] = { $regex: filterData.userName, $options: 'i' };
    if (filterData.phone) matchFilters['phone'] = { $regex: filterData.phone };
    if (filterData.isActive)
      matchFilters['isActive'] = filterData.isActive === 'active';

    const subscriptionFilter: Record<string, any> = {};
    if (filterData.planStartDate) {
      subscriptionFilter['startDate'] = {
        ...(filterData.planStartDate.$gte && {
          $gte: new Date(filterData.planStartDate.$gte),
        }),
        ...(filterData.planStartDate.$lte && {
          $lte: new Date(filterData.planStartDate.$lte),
        }),
      };
    }
    if (filterData.planExpiry) {
      subscriptionFilter['expiryDate'] = {
        ...(filterData.planExpiry.$gte && {
          $gte: new Date(filterData.planExpiry.$gte),
        }),
        ...(filterData.planExpiry.$lte && {
          $lte: new Date(filterData.planExpiry.$lte),
        }),
      };
    }
    if (filterData.planName)
      subscriptionFilter['plan'] = new Types.ObjectId(filterData.planName);
    if (filterData.toggleLimit)
      subscriptionFilter['toggleLimit'] = filterData.toggleLimit;

    if (filterData.contactsLimit) {
      subscriptionFilter.$expr = {
        $and: [
          ...(filterData.contactsLimit.$gte ||
          filterData.contactsLimit.$gte === 0
            ? [
                {
                  $gte: [
                    { $add: ['$contactLimit', '$contactLimitAddon'] },
                    filterData.contactsLimit.$gte,
                  ],
                },
              ]
            : []),
          ...(filterData.contactsLimit.$lte ||
          filterData.contactsLimit.$lte === 0
            ? [
                {
                  $lte: [
                    { $add: ['$contactLimit', '$contactLimitAddon'] },
                    filterData.contactsLimit.$lte,
                  ],
                },
              ]
            : []),
        ],
      };
    }

    if (filterData.employeeLimit) {
      subscriptionFilter.$expr = {
        $and: [
          ...(filterData.employeeLimit.$gte ||
          filterData.employeeLimit.$gte === 0
            ? [
                {
                  $gte: [
                    { $add: ['$employeeLimit', '$employeeLimitAddon'] },
                    filterData.employeeLimit.$gte,
                  ],
                },
              ]
            : []),
          ...(filterData.employeeLimit.$lte ||
          filterData.employeeLimit.$lte === 0
            ? [
                {
                  $lte: [
                    { $add: ['$employeeLimit', '$employeeLimitAddon'] },
                    filterData.employeeLimit.$lte,
                  ],
                },
              ]
            : []),
        ],
      };
    }

    if (filterData.usedContactsCount) {
      subscriptionFilter['contactCount'] = {
        ...((filterData.usedContactsCount.$gte ||
          filterData.usedContactsCount.$gte === 0) && {
          $gte: filterData.usedContactsCount.$gte,
        }),
        ...((filterData.usedContactsCount.$lte ||
          filterData.usedContactsCount.$lte === 0) && {
          $lte: filterData.usedContactsCount.$lte,
        }),
      };
    }

    const employeeCountFilter: Record<string, any> = {};
    ['totalEmployees', 'employeeSalesCount', 'employeeReminderCount'].forEach(
      (field) => {
        if (filterData[field]) employeeCountFilter[field] = filterData[field];
      },
    );

    const clientRoleId = this.configService.get('appRoles').ADMIN;
    const empSalesId = this.configService.get('appRoles').EMPLOYEE_SALES;
    const empReminderId = this.configService.get('appRoles').EMPLOYEE_REMINDER;

    const initialPipeline = [
      // Match clients with the admin role
      {
        $match: {
          role: new Types.ObjectId(`${clientRoleId}`),
          isDeleted: {
            $ne: true,
          },
          ...matchFilters,
        },
      },
    ];

    const pipeline = [
      ...initialPipeline,

      ...(!hasFilters
        ? [
            { $sort: { createdAt: -1 as const } },
            { $skip: skip },
            ...(limit ? [{ $limit: limit }] : []),
          ]
        : []),

      // Lookup subscriptions
      {
        $lookup: {
          from: 'subscriptions',
          localField: '_id',
          foreignField: 'admin',
          pipeline: [
            { $match: subscriptionFilter },
            {
              $lookup: {
                from: 'plans',
                localField: 'plan',
                foreignField: '_id',
                pipeline: [{ $project: { name: 1 } }],
                as: 'plan',
              },
            },
            { $unwind: { path: '$plan', preserveNullAndEmptyArrays: true } },
            {
              $project: {
                startDate: 1,
                expiryDate: 1,
                toggleLimit: 1,
                webinarLimit: 1,
                webinarLimitAddon: 1,
                contactLimitTotal: {
                  $add: ['$contactLimit', '$contactLimitAddon'],
                },
                employeeLimitTotal: {
                  $add: ['$employeeLimit', '$employeeLimitAddon'],
                },
                contactCount: 1,
                'plan.name': 1,
              },
            },
          ],
          as: 'subscription',
        },
      },
      { $unwind: { path: '$subscription', preserveNullAndEmptyArrays: false } },

      // Lookup employees
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: 'adminId',
          as: 'employees',
        },
      },

      // Add fields
      {
        $addFields: {
          planName: '$subscription.plan.name',
          planStartDate: '$subscription.startDate',
          planExpiry: '$subscription.expiryDate',
          toggleLimit: '$subscription.toggleLimit',
          webinarLimitAddon: '$subscription.webinarLimitAddon',
          webinarLimitTotal: {
            $add: [
              { $ifNull: ['$subscription.webinarLimit', 0] },
              { $ifNull: ['$subscription.webinarLimitAddon', 0] },
            ],
          },
          totalEmployees: { $size: '$employees' },
          employeeSalesCount: {
            $size: {
              $filter: {
                input: '$employees',
                as: 'emp',
                cond: {
                  $eq: ['$$emp.role', new Types.ObjectId(`${empSalesId}`)],
                },
              },
            },
          },
          employeeReminderCount: {
            $size: {
              $filter: {
                input: '$employees',
                as: 'emp',
                cond: {
                  $eq: ['$$emp.role', new Types.ObjectId(`${empReminderId}`)],
                },
              },
            },
          },
        },
      },

      // Apply employee count filters
      { $match: employeeCountFilter },

      // Add computed fields
      {
        $addFields: {
          remainingDays: {
            $max: [
              {
                $ceil: {
                  $divide: [
                    {
                      $subtract: [
                        { $toLong: '$subscription.expiryDate' },
                        { $toLong: new Date() },
                      ],
                    },
                    1000 * 60 * 60 * 24,
                  ],
                },
              },
              0,
            ],
          },
        },
      },

      ...(filterData.remainingDays
        ? [
            {
              $match: {
                remainingDays: {
                  ...((filterData.remainingDays.$gte ||
                    filterData.remainingDays.$gte === 0) && {
                    $gte: filterData.remainingDays.$gte,
                  }),
                  ...((filterData.remainingDays.$lte ||
                    filterData.remainingDays.$lte === 0) && {
                    $lte: filterData.remainingDays.$lte,
                  }),
                },
              },
            },
          ]
        : []),

      // Project final fields

      {
        $project: {
          email: 1,
          companyName: 1,
          userName: 1,
          phone: 1,
          isActive: 1,
          planName: 1,
          planStartDate: 1,
          planExpiry: 1,
          contactsLimit: '$subscription.contactLimitTotal',
          toggleLimit: 1,
          totalEmployees: 1,
          employeeSalesCount: 1,
          employeeReminderCount: 1,
          usedContactsCount: '$subscription.contactCount',
          employeeLimit: '$subscription.employeeLimitTotal',
          remainingDays: 1,
          dateFormat: 1,
          webinarLimitTotal: 1,
          webinarLimitAddon: 1,
        },
      },
    ];

    return {
      pipeline,
      initialPipeline,
    };
  }

  async getClients(
    skip: number,
    limit: number,
    filterData: GetClientsFilterDto,
    usePagination: boolean = true,
  ): Promise<any> {
    const hasFilters = Object.keys(filterData).length > 0;

    const { pipeline, initialPipeline } = this.createClientPipeline(
      filterData,
      hasFilters,
      skip,
      limit,
    );

    const mainPipeline = [
      ...pipeline,
      ...(hasFilters
        ? [
            { $sort: { createdAt: -1 as const } },
            { $skip: skip || 0 },
            { $limit: limit },
          ]
        : []),
    ];

    if (usePagination) {
      const totalUsersPipeline = [
        ...(hasFilters ? pipeline : initialPipeline),
        { $count: 'totalUsers' },
      ];

      const [result, totalUsersResult] = await Promise.all([
        this.userModel.aggregate(mainPipeline),
        this.userModel.aggregate(totalUsersPipeline),
      ]);

      const totalUsers = totalUsersResult[0]?.totalUsers || 0;
      const totalPages = Math.ceil(totalUsers / limit);

      return { result, totalPages };
    } else {
      const data = [];
      const cursor = this.userModel
        .aggregate([...pipeline, ...(limit ? [{ $limit: limit }] : [])])
        .cursor();

      for await (const doc of cursor) {
        data.push(doc);
      }
      return data;
    }
  }

  async getClient(id: string): Promise<any> {
    const pipeline: mongoose.PipelineStage[] = [
      { $match: { _id: new Types.ObjectId(`${id}`) } },
      {
        $lookup: {
          from: 'subscriptions',
          localField: '_id',
          foreignField: 'admin',
          as: 'subscription',
        },
      },
      {
        $lookup: {
          from: 'billinghistories',
          localField: '_id',
          foreignField: 'admin',
          as: 'billingHistory',
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: 'adminId',
          as: 'employees',
        },
      },
      {
        $lookup: {
          from: 'plans',
          localField: 'plan',
          foreignField: '_id',
          as: 'plan',
        },
      },

      {
        $addFields: {
          plan: {
            $arrayElemAt: ['$plan', 0],
          },
        },
      },
      {
        $lookup: {
          from: 'attendees',
          let: { adminId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$adminId', '$$adminId'] } } },
            { $count: 'totalCount' },
          ],
          as: 'contactsCount',
        },
      },
      {
        $addFields: {
          contactsCount: {
            $ifNull: [{ $arrayElemAt: ['$contactsCount.totalCount', 0] }, 0],
          },
        },
      },
      {
        $project: {
          password: 0,
        },
      },
    ];

    const result = await this.userModel.aggregate(pipeline);
    return result;
  }

  async updateClient(
    id: string,
    updateUserInfoDto: UpdateUserInfoDto,
  ): Promise<any> {
    if (updateUserInfoDto.userName || updateUserInfoDto.email) {
      const isExisting = await this.userModel.findOne({
        email: updateUserInfoDto.email,
        _id: { $ne: id },
      });

      if (isExisting) {
        throw new NotAcceptableException('E-Mail already exists');
      }
    }

    if (updateUserInfoDto.password) {
      const hashPassword = await bcrypt.hash(updateUserInfoDto.password, 10);
      updateUserInfoDto.password = hashPassword;
    }

    const result = await this.userModel.findByIdAndUpdate(
      id,
      updateUserInfoDto,
      { new: true },
    );
    await this.invalidateUserCache(id, 'updateClient');
    if (result && updateUserInfoDto.isActive === false) {
      await this.notificationService.createNotification({
        recipient: result._id.toString(),
        title: 'Account Deactivation Notice',
        message: `Your account has been deactivated. Please contact the super admin for more details.`,
        type: notificationType.INFO,
        actionType: notificationActionType.ACCOUNT_DEACTIVATION,
      });

      const employees = await this.userModel.find({
        adminId: result._id,
        isActive: true,
      });

      for (const employee of employees) {
        await this.userModel.findByIdAndUpdate(employee._id, {
          $set: { isActive: false },
        });
        await this.invalidateUserCache(
          String(employee._id),
          'updateClient:deactivateEmployee',
        );

        await this.notificationService.createNotification({
          recipient: employee._id.toString(),
          title: 'Admin Account Deactivation Notice',
          message: `The admin account you are associated with has been deactivated. Please contact your admin for further instructions.`,
          type: notificationType.INFO,
          actionType: notificationActionType.ACCOUNT_DEACTIVATION,
        });
      }
    }

    if (result && updateUserInfoDto.planExpiry) {
      const planExpiryDate = new Date(updateUserInfoDto.planExpiry);
      planExpiryDate.setHours(23, 59);
      await this.subscriptionService.updateSubscriptionExpiryDate(
        result._id as Types.ObjectId,
        planExpiryDate,
      );
    }

    if (
      result &&
      typeof updateUserInfoDto.webinarLimitAddon !== 'undefined' &&
      updateUserInfoDto.webinarLimitAddon !== null
    ) {
      const parsedAddon = Number(updateUserInfoDto.webinarLimitAddon);
      const safeAddon =
        Number.isFinite(parsedAddon) && parsedAddon >= 0 ? parsedAddon : 0;
      await this.subscriptionService.updateWebinarLimitAddon(
        String(result._id),
        safeAddon,
      );
    }

    return result;
  }

  async getEmployees(
    adminId: string,
    page: number = 1,
    limit: number = 10,
    filters: EmployeeFilterDTO = {},
  ) {
    const skip = (page - 1) * limit;

    const pipeline: PipelineStage[] = [
      {
        $match: {
          adminId: new mongoose.Types.ObjectId(adminId),
        },
      },
      {
        $match: {
          ...(filters.email && {
            email: { $regex: filters.email, $options: 'i' },
          }),
          ...(filters.userName && {
            userName: { $regex: filters.userName, $options: 'i' },
          }),
          ...(filters.phone && {
            phone: { $regex: filters.phone, $options: 'i' },
          }),
          ...(filters.isActive && {
            isActive: filters.isActive === 'active',
          }),
          ...(filters.validCallTime && {
            validCallTime: filters.validCallTime,
          }),
          ...(filters.dailyContactLimit && {
            dailyContactLimit: filters.dailyContactLimit,
          }),
          ...(filters.role && { role: new Types.ObjectId(filters.role) }),
        },
      },
      {
        $lookup: {
          from: 'roles', // Collection name where roles are stored
          localField: 'role', // The field in the current collection
          foreignField: '_id', // The field in the roles collection
          as: 'roleInfo', // The resulting array field
        },
      },
      {
        $set: {
          role: { $arrayElemAt: ['$roleInfo.name', 0] }, // Replace `role` with the first matching `roleInfo.name`
        },
      },
      {
        $project: { password: 0 },
      },
      {
        $unset: 'roleInfo', // Remove the temporary `roleInfo` array
      },
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [{ $skip: skip }, { $limit: limit }],
        },
      },
      {
        $unwind: '$metadata', // Unwind to convert metadata array to object
      },
      {
        $project: {
          result: '$data',
          totalPages: {
            $ceil: { $divide: ['$metadata.total', limit] }, // Calculate total pages
          },
          page: { $literal: page }, // Add current page info
        },
      },
    ];

    const result = await this.userModel.aggregate(pipeline).exec();

    return result[0] || { result: [], totalPages: 0, page: page };
  }

  async getEmployeesCount(AdminId: string): Promise<any> {
    const query = {
      adminId: new Types.ObjectId(`${AdminId}`),
      isActive: true,
    };

    const totalContacts = (await this.userModel.countDocuments(query)) || 0;

    return totalContacts;
  }

  getEmployee(id: string): Promise<User | null> {
    const employee = this.userModel.findById(id).select('-password');

    return employee;
  }

  async getUser(email: string): Promise<User> {
    const user = await this.userModel.findOne({ email: email });
    return user;
  }

  async getAdminIdByEmail(email: string): Promise<string | null> {
    const normalized = email.trim().toLowerCase();
    const user = await this.userModel
      .findOne({ email: normalized })
      .select('_id');
    return user ? String(user._id) : null;
  }

  private async invalidateUserCache(
    userIds: string | Types.ObjectId | Array<string | Types.ObjectId | null | undefined>,
    trigger: string,
  ): Promise<void> {
    const ids = (Array.isArray(userIds) ? userIds : [userIds])
      .map((id) => (id ? String(id) : ''))
      .filter(Boolean);
    if (!ids.length) return;
    await this.userCacheService.invalidate(ids, trigger);
  }

  async getUserById(id: string) {
    const cached = await this.userCacheService.get(id);
    if (cached === UserCacheService.getMissingSentinel()) {
      this.logger.log(`getUserById: userId=${id} source=redis (not-found sentinel)`);
      return null;
    }
    if (cached) {
      this.logger.log(
        `getUserById: userId=${id} source=redis (cache hit) isActive=${cached.isActive}`,
      );
      return this.userModel.hydrate(cached);
    }

    this.logger.log(`getUserById: userId=${id} source=mongodb (cache miss)`);
    const user = await this.userModel.findById(id).select('-password');
    if (!user) {
      await this.userCacheService.set(id, null);
      this.logger.log(
        `getUserById: userId=${id} source=mongodb (user not found, cached sentinel)`,
      );
      return null;
    }

    await this.userCacheService.set(id, user.toObject() as unknown as CachedUserRecord);
    this.logger.log(
      `getUserById: userId=${id} source=mongodb (loaded, written to redis) isActive=${user.isActive}`,
    );
    return user;
  }

  async updateUser(
    id: string,
    updateUserInfoDto: UpdateUserInfoDto,
  ): Promise<any> {
    if (updateUserInfoDto.email) {
      const isExisting = await this.userModel.findOne({
        email: updateUserInfoDto.email,
        _id: { $ne: id },
      });

      if (isExisting) {
        throw new NotAcceptableException('E-Mail already exists');
      }
    }

    //deleting updateUserInfoDto unus
    delete updateUserInfoDto.password;
    delete updateUserInfoDto.isActive;
    delete updateUserInfoDto.statusChangeNote;
    // Append documents if provided
    if (updateUserInfoDto.documents?.length > 0) {
      const user = await this.userModel.findById(id);

      if (!user) {
        throw new NotFoundException('User not found');
      }

      // Combine existing documents with new ones
      const updatedDocuments = [
        ...(user.documents || []),
        ...updateUserInfoDto.documents,
      ];

      updateUserInfoDto.documents = updatedDocuments;
    }
    const result = await this.userModel.findByIdAndUpdate(
      id,
      updateUserInfoDto,
      { new: true },
    );
    await this.invalidateUserCache(id, 'updateUser');
    return result;
  }

  async getUserActivityOfEmployees(adminId: Types.ObjectId) {
    const pipeline: PipelineStage[] = [
      {
        $match: {
          adminId,
          isActive: true,
        },
      },
      {
        $lookup: {
          from: 'roles',
          localField: 'role',
          foreignField: '_id',
          as: 'roleDetails',
        },
      },
      {
        $unwind: {
          path: '$roleDetails',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $lookup: {
          from: 'useractivities',
          let: {
            tempAdmin: '$adminId',
            tempUser: '$_id',
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$adminId', '$$tempAdmin'] },
                    { $eq: ['$user', '$$tempUser'] },
                  ],
                },
              },
            },
            {
              $sort: {
                createdAt: -1,
              },
            },
            {
              $limit: 1,
            },
          ],
          as: 'useractivities',
        },
      },
      {
        $unwind: {
          path: '$useractivities',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          action: '$useractivities.action',
          createdAt: '$useractivities.createdAt',
          details: '$useractivities.details',
          updatedAt: '$useractivities.updatedAt',
          userEmail: '$email',
          userName: 1,
          userRole: '$roleDetails.name',
        },
      },
    ];

    const employees = await this.userModel.aggregate(pipeline).exec();
    employees.forEach((employee) => {
      if (this.socketGateway.activeUsers.has(employee._id.toString())) {
        employee['isOnline'] = true;
      } else {
        employee['isOnline'] = false;
      }
    });
    return employees;
  }

  async deleteDocument(id: string, filename: string): Promise<any> {
    const user = await this.userModel.findById(id);

    if (!user) throw new NotFoundException('No user found.');

    const documents = user.documents;

    const filteredDocuments = documents.filter(
      (doc) => doc.filename !== filename,
    );

    user.documents = filteredDocuments;

    //add logic for deleting file from server here

    const result = user.save();

    return result;
  }

  async updatePassword(
    id: string,
    updatePasswordDto: UpdatePasswordDto,
  ): Promise<any> {
    const user = await this.userModel.findById(id);

    const verifyOldPassword = await bcrypt.compare(
      updatePasswordDto.oldPassword,
      user.password,
    );

    if (!verifyOldPassword)
      throw new NotAcceptableException(
        "Old password does not match the one in our database, If you don't recall it, please try Forgot Password option.",
      );

    if (updatePasswordDto.password !== updatePasswordDto.confirmPassword)
      throw new NotAcceptableException(
        'New password does not match, please enter correct one and try again.',
      );

    const newPassword = await bcrypt.hash(updatePasswordDto.password, 10);

    await this.userModel.findByIdAndUpdate(
      id,
      { password: newPassword },
      { new: true },
    );
    await this.invalidateUserCache(id, 'updatePassword');
    return { message: 'Password updated successfully!' };
  }

  async createEmployee(
    createEmployeeDto: CreateEmployeeDto,
    creatorDetailsDto: CreatorDetailsDto,
  ): Promise<any> {
    const role = await this.rolesService.getRoleByName(createEmployeeDto?.role);
    if (!role) throw new NotFoundException('No Role Found with the given ID.');
    const user = await this.userModel.create({
      ...createEmployeeDto,
      role: role._id,
      adminId: creatorDetailsDto.id,
    });
    return user;
  }

  async updateEmployee(
    id: string,
    updateEmployeeDto: UpdateEmployeeDto,
  ): Promise<any> {
    if (updateEmployeeDto.email) {
      const isExisting = await this.userModel.findOne({
        email: updateEmployeeDto.email,
        _id: { $ne: id },
      });

      if (isExisting) {
        throw new NotAcceptableException('E-Mail already exists');
      }
    }

    if (updateEmployeeDto.password) {
      const hashPassword = await bcrypt.hash(updateEmployeeDto.password, 10);
      updateEmployeeDto.password = hashPassword;
    }
    const role = await this.rolesService.getRoleByName(updateEmployeeDto?.role);

    if (!role) throw new NotFoundException('No Role Found with the given ID.');

    const result = await this.userModel.findByIdAndUpdate(
      id,
      {
        userName: updateEmployeeDto.userName,
        email: updateEmployeeDto.email,
        phone: updateEmployeeDto.phone,
        validCallTime: updateEmployeeDto.validCallTime,
        dailyContactLimit: updateEmployeeDto.dailyContactLimit,
        role: role._id,
        inactivityTime: updateEmployeeDto.inactivityTime,
        ...(updateEmployeeDto.password
          ? { password: updateEmployeeDto.password }
          : {}),
        tags: updateEmployeeDto.tags,
      },
      { new: true },
    );
    await this.invalidateUserCache(id, 'updateEmployee');
    return result;
  }

  async changeEmployeeStatus(
    userId: string,
    adminId: string,
    status: boolean,
  ): Promise<any> {
    const subscription: any =
      await this.subscriptionService.getSubscription(adminId);

    if (!subscription) {
      throw new NotFoundException('No Subscription Found with the given ID.');
    }

    if (subscription.toggleLimit <= 0) {
      throw new NotAcceptableException('Your toggle limit has expired.');
    }

    if (new Date(subscription.expiryDate) < new Date()) {
      throw new NotAcceptableException(
        'Your subscription has expired. Please renew your subscription to continue.',
      );
    }

    const totalEmployeeLimit =
      (subscription.employeeLimit ?? 0) +
      (subscription.employeeLimitAddon ?? 0);

    const existingEmpCount = await this.userModel.countDocuments({
      adminId: new Types.ObjectId(`${adminId}`),
      isActive: true,
    });

    if (existingEmpCount >= totalEmployeeLimit && status) {
      throw new NotAcceptableException('You have reached your employee limit');
    }

    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('No User Found with the given ID.');
    }

    user.isActive = status;
    await user.save();
    await this.invalidateUserCache(userId, 'changeEmployeeStatus');

    subscription.toggleLimit = subscription.toggleLimit - 1;
    subscription.employeeLimit = subscription.employeeLimit || 0;
    await subscription.save();
    return { message: 'Status updated successfully!', subscription };
  }

  async createClient(
    createClientDto: CreateClientDto,
    creatorDetailsDto: CreatorDetailsDto,
  ): Promise<any> {
    if (!createClientDto.email) {
      throw new BadRequestException('E-Mail is required');
    }

    // Normalize email to avoid duplicates due to casing/spacing
    const normalizedEmail = createClientDto.email.trim().toLowerCase();
    createClientDto.email = normalizedEmail;

    const plan = await this.plansService.getPlan(
      createClientDto.plan as string,
    );

    const isDurationConfig = plan.planDurationConfig.has(
      createClientDto.durationType,
    );
    if (!isDurationConfig) {
      throw new NotFoundException('Duration type not found');
    }

    const durationConfig = plan.planDurationConfig.get(
      createClientDto.durationType,
    );
    if (!durationConfig.isEnabled) {
      throw new NotAcceptableException('Duration type is not enabled');
    }

    const date = new Date();
    const currentPlanExpiry = date.setDate(
      date.getDate() + durationConfig.duration,
    );
    createClientDto.currentPlanExpiry = currentPlanExpiry;

    /**
    // * test for date in frontend to be in IST
     * let date = new Date('2024-12-02T06:14:48.287Z')
     */

    try {
      // Check if a user already exists
      const existingUser = await this.userModel.findOne({
        email: normalizedEmail,
      });

      if (existingUser) {
        // Existing client: update its subscription plan instead of creating a new user
        const { subscription, billing } =
          await this.subscriptionService.updateClientPlan(
            String(existingUser._id),
            String(plan._id),
            createClientDto.durationType,
          );

        const user = await this.userModel
          .findById(existingUser._id)
          .select('-password');

        return { user, subscription, billingHistory: billing };
      }

      const userData = await this.userModel.create({
        email: createClientDto.email,
        userName: createClientDto.userName,
        password: createClientDto.password,
        phone: createClientDto.phone,
        role: createClientDto.role,
        companyName: createClientDto.companyName,
        adminId: creatorDetailsDto.id,
        dateFormat: createClientDto.dateFormat,
      });

      const payload = {
        id: userData?._id,
        role: userData?.role,
        adminId: userData?.adminId,
      };

      const token = await this.jwtService.signAsync(payload, {
        secret: this.configService.get('PABBLY_CLIENT_ACCESS_TOKEN_SECRET'),
      });

      const user = await this.userModel
        .findByIdAndUpdate(
          String(userData?._id),
          { pabblyToken: token },
          { new: true },
        )
        .select('-password');

      const subscriptionPayload: SubscriptionDto = {
        admin: String(user._id),
        plan: String(plan._id),
        contactLimit: plan.contactLimit,
        employeeLimit: plan.employeeCount,
        toggleLimit: plan.toggleLimit,
        webinarLimit: plan.webinarLimit,
        whatsappProjectLimit: plan.whatsappProjectLimit || 0,
        zoomProjectLimit: plan.zoomProjectLimit || 0,
        expiryDate: currentPlanExpiry,
      };

      const subscription =
        await this.subscriptionService.addSubscription(subscriptionPayload);

      const { totalWithGST, itemAmount, discountAmount, gst } =
        this.subscriptionService.generatePriceForPlan(durationConfig);

      const billingHistory = await this.billingHistoryService.addBillingHistory(
        {
          admin: String(user._id),
          plan: String(plan._id),
          amount: totalWithGST,
          itemAmount: itemAmount,
          discountAmount: discountAmount,
          taxPercent: this.subscriptionService.GST_VALUE,
          taxAmount: gst,
          durationType: createClientDto.durationType,
          startDate: new Date(),
          expiryDate: new Date(currentPlanExpiry),
        },
        BillingType.NEW_PLAN,
      );

      await this.customLeadTypeService.createDefaultLeadTypes(`${user._id}`);
      await this.productsService.createDefaultProductLevels(
        user._id as Types.ObjectId,
      );

      return { user, subscription, billingHistory };
    } catch (error) {
      // Handle race condition / duplicate key on email
      if (
        error &&
        (error as any).code === 11000 &&
        ((error as any).keyPattern?.email || (error as any).keyValue?.email)
      ) {
        throw new BadRequestException('User with this E-Mail already exists.');
      }

      throw error;
    }
  }

  // Method to check expired plans and deactivate users
  async deactivateExpiredPlans(): Promise<void> {
    const now = new Date();
    const adminRole = this.configService.get('appRoles').ADMIN;
    const expiredAdminIds =
      await this.subscriptionService.getExpiredSubscriptions();
    if (!Array.isArray(expiredAdminIds) || expiredAdminIds.length == 0) return;
    try {
      const result = await this.userModel.updateMany(
        {
          _id: { $in: expiredAdminIds },
          isActive: true,
          role: new Types.ObjectId(`${adminRole}`),
        },
        {
          $set: {
            isActive: false,
            statusChangeNote:
              'Account automatically deactivated due to plan expiration.',
          },
        },
      );
      //TODO: send email to super admin

      this.logger.log(
        `Deactivated ${result.modifiedCount} users with expired plans.`,
      );

      if (result.modifiedCount > 0) {
        const deactivatedAdminIds = await this.userModel
          .find(
            {
              currentPlanExpiry: { $lt: now },
              role: new Types.ObjectId(`${adminRole}`),
            },
            { _id: 1 },
          )
          .exec();

        const adminIds = deactivatedAdminIds.map((admin) => admin._id);

        const employeeResult = await this.userModel.updateMany(
          {
            adminId: { $in: adminIds },
            isActive: true,
          },
          {
            $set: { isActive: false },
          },
        );

        this.logger.log(
          `Deactivated ${employeeResult.modifiedCount} employees of ${result.modifiedCount} admins with expired plans.`,
        );
      }
    } catch (error) {
      this.logger.error('Error during plan deactivation:', error.message);
    }
  }

  async deleteexpiryTOkens() {
    await this.apiTokenService.deleteExpiredTokens();
  }

  async alertAdminsForExpiry(): Promise<any> {
    const expiredAdminIds = await this.subscriptionService.getUpcomingExpiry();
    if (!Array.isArray(expiredAdminIds) || expiredAdminIds.length == 0) return;
    try {
      for (let i = 0; i < expiredAdminIds.length; i++) {
        const admin = await this.userModel.findById(
          expiredAdminIds[i].admin.toString(),
        );
        if (admin) {
          await this.notificationService.createNotification({
            recipient: admin._id.toString(),
            title: 'Plan Expiry Alert',
            message: `Your subscription plan is about to expire in 15 days. Please renew your subscription on or before ${new Date(expiredAdminIds[i].expiryDate).toDateString()} to continue using the services.`,
            type: notificationType.WARNING,
            actionType: notificationActionType.EXPIRY_REMINDER,
          });

          //add whatsapp notification here
        }
      }

      this.logger.log(`Notification sent to users with upcoming expiry dates.`);
    } catch (error) {
      this.logger.error('Error during plan deactivation:', error.message);
    }
  }

  async incrementCount(
    id: string,
    incrementValue: number = 1,
    session?: ClientSession,
  ): Promise<boolean> {
    const user = await this.userModel.findById(id).session(session).exec();
    if (user) {
      user.dailyContactCount = (user.dailyContactCount || 0) + incrementValue;
      await user.save({ session });
      return true;
    }
    return false;
  }

  async resetDailyContactCount() {
    return await this.userModel.updateMany(
      {
        dailyContactCount: { $gt: 0 },
      },
      { $set: { dailyContactCount: 0 } },
    );
  }

  async getSuperAdminDetails(whatsappToken: boolean = false) {
    const role = this.configService.get('appRoles').SUPER_ADMIN;
    const superAdmin = await this.userModel
      .findOne({ role: new Types.ObjectId(`${role}`) })
      .select(
        `companyName email address ${whatsappToken ? 'whatsappToken' : ''}`,
      )
      .exec();
    return superAdmin;
  }

  async updateWhatsappToken(id: string, whatsappToken: string) {
    return await this.userModel
      .findByIdAndUpdate(id, { whatsappToken }, { new: true })
      .select(' whatsappToken');
  }

  async getClientsForDropdown() {
    const clients = await this.userModel.find({
      role: new Types.ObjectId(`${this.configService.get('appRoles').ADMIN}`),
    });

    if (Array.isArray(clients)) {
      return clients.map((client) => ({
        label: client.email,
        value: client._id,
      }));
    }
    return [];
  }

  async getEmployeesForNotes(adminId: Types.ObjectId) {
    return this.userModel.find({ adminId }, '_id email userName isActive role');
  }

  /**
   * Used by cron jobs to ensure only active admins' projects are processed.
   */
  async findActiveUsersByIds(
    ids: Array<Types.ObjectId | string>,
  ): Promise<Array<Pick<User, '_id'>>> {
    if (!ids?.length) return [];

    return this.userModel
      .find({ _id: { $in: ids }, isActive: true })
      .select('_id')
      .lean();
  }

  async updateEmployeeAssignmentCounts(
    empData: { _id: Types.ObjectId; count: number }[],
  ) {
    // Check if there's any data to process
    if (!empData || empData.length === 0) {
      return { acknowledged: true, modifiedCount: 0, matchedCount: 0 }; // Mimic bulkWrite result structure
    }

    // Prepare bulk operations array
    const operations = empData.map((emp) => ({
      updateOne: {
        filter: { _id: emp._id },
        // Use an update pipeline to calculate the new value safely
        update: [
          {
            $set: {
              dailyContactCount: {
                // Calculate the maximum of 0 and (current value - decrement count)
                $max: [
                  0, // Ensures the floor is 0
                  { $subtract: ['$dailyContactCount', emp.count] }, // Decrease by the specific count
                ],
              },
            },
          },
        ],
      },
    }));

    // Execute the bulk write operation
    const result = await this.userModel.bulkWrite(operations, {
      ordered: false, // Process updates even if some fail (optional)
    });
    await this.userCacheService.invalidateAfterBulkWrite(
      operations,
      'bulkWrite:updateEmployeeAssignmentCounts',
    );
    return result;
  }

  async updateDailyContactCount(
    data: {
      _id: Types.ObjectId;
      totalAssignments: number;
    }[],
    adminId: Types.ObjectId,
    session?: ClientSession,
  ) {
    const userIdsInData = data.map((d) => d._id);

    // Step 1: Update employees from `data`
    const updateAssignments = data.map((emp) => ({
      updateOne: {
        filter: { _id: emp._id },
        update: [
          {
            $set: {
              dailyContactCount: emp.totalAssignments,
            },
          },
        ],
      },
    }));

    // Step 2: Set `dailyContactCount` to 0 for others not in `data` and with count > 0
    const resetUnassigned = {
      updateMany: {
        filter: {
          adminId,
          _id: { $nin: userIdsInData },
          dailyContactCount: { $gt: 0 },
        },
        update: {
          $set: { dailyContactCount: 0 },
        },
      },
    };

    const operations = [...updateAssignments, resetUnassigned];

    const result = await this.userModel.bulkWrite(operations, {
      ordered: false,
      session,
    });
    await this.userCacheService.invalidateAfterBulkWrite(
      operations,
      'bulkWrite:updateDailyContactCount',
    );
    return result;
  }

  async updateDailyContactCountSingle(
    totalAssignments: number,
    empId: Types.ObjectId,
  ) {
    const result = await this.userModel.findByIdAndUpdate(empId, {
      $set: {
        dailyContactCount: totalAssignments,
      },
    });
    await this.invalidateUserCache(empId, 'updateDailyContactCountSingle');
    return result;
  }

  async bulkUpdateUsersDailyContactCount(
    updates: any[], // Using 'any' for simplicity, can be typed as (BulkWriteOptions | AnyBulkWriteOperation)[]
    session: ClientSession, // Requires a session as it's designed for use within a transaction
  ): Promise<any> {
    // Return type is Mongoose BulkWriteResult, using 'any' for now
    if (!session) {
      // This function is designed for use within transactions, ensure a session is provided
      throw new Error(
        'bulkUpdateUsersDailyContactCount requires a Mongoose client session.',
      );
    }
    if (!updates || updates.length === 0) {
      // Return a result object indicating no operations were performed, similar to bulkWrite output structure
      return {
        acknowledged: true,
        insertedCount: 0,
        matchedCount: 0,
        modifiedCount: 0,
        deletedCount: 0,
        upsertedCount: 0,
        upsertedIds: {},
      };
    }

    try {
      // Use the injected Mongoose userModel to perform the bulk write operation
      // Pass the array of update operations and the session object
      const result = await this.userModel.bulkWrite(updates, { session });
      await this.userCacheService.invalidateAfterBulkWrite(
        updates,
        'bulkWrite:bulkUpdateUsersDailyContactCount',
      );

      // Log the result or perform other checks if necessary
      // console.log('User dailyContactCount bulk write operation completed:', result);

      // Mongoose's bulkWrite returns an object containing statistics about the operations performed.
      // Example: { acknowledged: true, insertedCount: 0, matchedCount: 2, modifiedCount: 2, deletedCount: 0, upsertedCount: 0, upsertedIds: {} }
      return result; // This is the BulkWriteResult object
    } catch (error) {
      console.error(
        'Error during User dailyContactCount bulk write operation:',
        error,
      );
      // Re-throw the error so the calling transaction can catch and handle it
      throw error;
    }
  }

  async deactivateUserByAdminId(adminId: Types.ObjectId) {
    const admin = await this.userModel.findById(adminId);
    if (!admin) {
      throw new NotFoundException('Admin not found');
    }

    admin.isActive = false;
    admin.statusChangeNote = 'Account deactivated by super admin.';
    await admin.save();

    const employees = await this.userModel
      .find({ adminId: admin._id })
      .select('_id')
      .lean();
    await this.userModel.updateMany(
      { adminId: admin._id },
      { $set: { isActive: false } },
    );

    await this.invalidateUserCache(
      [String(admin._id), ...employees.map((e) => String(e._id))],
      'deactivateUserByAdminId',
    );

    return {
      message: 'User and associated employees deactivated successfully.',
    };
  }

  async softDeleteUser(adminId: Types.ObjectId) {
    const user = await this.userModel.findOne({
      _id: adminId,
      isDeleted: {
        $ne: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Admin User Not Found');
    }

    user.isDeleted = true;
    await user.save();
    await this.invalidateUserCache(adminId, 'softDeleteUser:admin');

    this.socketGateway.emitSocketEvent(`${user._id}`, SocketEvents.LOG_OUT, {});

    const employeesUpdateResult = await this.userModel.updateMany(
      {
        adminId: adminId,
        isDeleted: { $ne: true },
      },
      {
        $set: {
          isDeleted: true,
        },
      },
    );

    const employeesForLogout = await this.userModel.find({
      adminId: adminId,
    });

    employeesForLogout.forEach((employee) => {
      this.socketGateway.emitSocketEvent(
        `${employee._id}`,
        SocketEvents.LOG_OUT,
        {},
      );
    });

    await this.invalidateUserCache(
      employeesForLogout.map((e) => String(e._id)),
      'softDeleteUser:employees',
    );

    return {
      success: true,
      message: `1 Admin and ${employeesUpdateResult.modifiedCount} Employees Soft Deleted Successfully`,
    };
  }

  async signUp(payload: any): Promise<any> {
    const { name, email, password, phone } = payload;
    if (!email) {
      throw new BadRequestException('E-Mail is required');
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check if user already exists
    const existingUser = await this.userModel.findOne({ email: normalizedEmail });
    if (existingUser) {
      throw new BadRequestException('User with this E-Mail already exists.');
    }

    const roleId = this.configService.get('appRoles').ADMIN;
    const hashPassword = await bcrypt.hash(password, 10);

    // Find the first active plan in the system as a default plan for new signups
    let plan = await this.userModel.db.model('Plans').findOne({ isActive: true });
    
    // Fallback default duration values
    let durationType = 'MONTHLY';
    let currentPlanExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days default

    if (plan) {
      // planDurationConfig is a Map on the Plans schema
      const planDurationConfig = plan.planDurationConfig;
      if (planDurationConfig instanceof Map) {
        for (const [key, value] of planDurationConfig.entries()) {
          if (value && value.isEnabled) {
            durationType = key;
            currentPlanExpiry = Date.now() + (value.duration || 30) * 24 * 60 * 60 * 1000;
            break;
          }
        }
      }
    }

    // Create Admin user
    const userData = await this.userModel.create({
      email: normalizedEmail,
      userName: name || normalizedEmail.split('@')[0],
      password: hashPassword,
      phone: phone || '',
      role: new Types.ObjectId(roleId),
      isActive: true,
    });

    // Generate Pabbly Token
    const tokenPayload = {
      id: userData?._id,
      role: userData?.role,
      adminId: userData?.adminId,
    };
    const token = await this.jwtService.signAsync(tokenPayload, {
      secret: this.configService.get('PABBLY_CLIENT_ACCESS_TOKEN_SECRET'),
    });

    const user = await this.userModel
      .findByIdAndUpdate(
        String(userData?._id),
        { pabblyToken: token },
        { new: true },
      )
      .select('-password');

    // Create Subscription
    if (plan) {
      const subscriptionPayload: SubscriptionDto = {
        admin: String(user._id),
        plan: String(plan._id),
        contactLimit: plan.contactLimit || 1000,
        employeeLimit: plan.employeeCount || 5,
        toggleLimit: plan.toggleLimit || 10,
        webinarLimit: plan.webinarLimit || 5,
        whatsappProjectLimit: plan.whatsappProjectLimit || 0,
        zoomProjectLimit: plan.zoomProjectLimit || 0,
        expiryDate: currentPlanExpiry,
      };

      await this.subscriptionService.addSubscription(subscriptionPayload);

      // Create Billing History
      let totalWithGST = 0;
      let itemAmount = 0;
      let discountAmount = 0;
      let gst = 0;

      if (plan.planDurationConfig instanceof Map) {
        const durationConfig = plan.planDurationConfig.get(durationType);
        if (durationConfig) {
          const generated = this.subscriptionService.generatePriceForPlan(durationConfig);
          totalWithGST = generated.totalWithGST;
          itemAmount = generated.itemAmount;
          discountAmount = generated.discountAmount;
          gst = generated.gst;
        }
      }

      await this.billingHistoryService.addBillingHistory(
        {
          admin: String(user._id),
          plan: String(plan._id),
          amount: totalWithGST,
          itemAmount: itemAmount,
          discountAmount: discountAmount,
          taxPercent: this.subscriptionService.GST_VALUE || 0,
          taxAmount: gst,
          durationType: durationType as any,
          startDate: new Date(),
          expiryDate: new Date(currentPlanExpiry),
        },
        BillingType.NEW_PLAN,
      );
    }

    // Default Configuration setup
    await this.customLeadTypeService.createDefaultLeadTypes(`${user._id}`);
    await this.productsService.createDefaultProductLevels(
      user._id as Types.ObjectId,
    );

    // Track Affiliate referrals
    if (payload.ref) {
      try {
        const affiliateModel = this.userModel.db.model('Affiliate');
        const referralModel = this.userModel.db.model('Referral');

        // Find the referrer affiliate by their referral code
        const referrerAffiliate = await affiliateModel.findOne({
          referralCode: payload.ref,
        });

        if (referrerAffiliate) {
          // 1. Create Tier 1 Referral
          await referralModel.create({
            referrerId: referrerAffiliate.userId,
            referredId: user._id,
            tier: 1,
            status: 'signup',
            commission: 0,
          });

          // 2. Check for Tier 2: see if the referrer themselves has a referrer
          const parentReferral = await referralModel.findOne({
            referredId: referrerAffiliate.userId,
            tier: 1,
          });

          if (parentReferral) {
            await referralModel.create({
              referrerId: parentReferral.referrerId,
              referredId: user._id,
              tier: 2,
              status: 'signup',
              commission: 0,
            });
          }
        }
      } catch (err) {
        // Safe catch to ensure signup does not crash if affiliate tracking fails
        this.logger.error('Failed to register affiliate referral details', err.stack);
      }
    }

    return {
      status: true,
      message: 'New Account Created Successfully',
      data: user,
    };
  }
}
