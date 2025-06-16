import {
  forwardRef,
  Inject,
  Injectable,
  NotAcceptableException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { ClientSession, Model, PipelineStage, Types } from 'mongoose';
import { AssignType, Enrollment } from 'src/schemas/Enrollments.schema';
import {
  CreateEnrollmentDto,
  EnrollmentsByLevelOrProductDTO,
  UpdateEnrollmentDto,
} from './dto/enrollment.dto';
import { ProductsService } from 'src/products/products.service';
import { AttendeeLogService } from 'src/attendee-log/attendee-log.service';
import { AttendeeAction } from 'src/schemas/attendee-logs.schema';
import { Products } from 'src/schemas/Products.schema';
import { WebinarService } from 'src/webinar/webinar.service';

@Injectable()
export class EnrollmentsService {
  constructor(
    @InjectModel(Enrollment.name)
    private readonly enrollmentModel: Model<Enrollment>,
    @Inject(forwardRef(() => ProductsService))
    private readonly productsService: ProductsService,
    private readonly attendeeLogService: AttendeeLogService,
    @Inject(forwardRef(() => WebinarService))
    private readonly webinarService: WebinarService,
  ) {}

  async createEnrollments(
    tagsData: {
      email: string;
      tags: string[];
    }[],
    webinarId: Types.ObjectId,
    adminId: Types.ObjectId,
    session: ClientSession,
  ): Promise<any[]> {
    // Adjust return type based on insertMany result

    const webinar = await this.webinarService.getAssignedProducts(webinarId);
    console.log(tagsData, webinar);

    if (
      !webinar ||
      !Array.isArray(webinar.productIds) ||
      webinar.productIds.length === 0 ||
      tagsData.length === 0
    )
      return [];

    const products: any[] = webinar.productIds;

    const productMap = new Map(
      products
        .filter(
          (product) =>
            typeof product.tag === 'string' && product.tag.trim() !== '',
        )
        .map((product) => [
          product.tag.toLowerCase(),
          {
            id: product._id,
            price: product.price,
          },
        ]),
    );

    const potentialEnrollments = []; // Renamed for clarity

    tagsData.forEach((item) => {
      const attendeeEmail = item.email;
      const attendeeTags = item.tags;
      attendeeTags.forEach((tag) => {
        const lowerCaseTag = tag.toLowerCase(); // Ensure case-insensitive matching
        if (typeof tag === 'string' && productMap.has(lowerCaseTag)) {
          const product = productMap.get(lowerCaseTag);

          potentialEnrollments.push({
            attendee: attendeeEmail,
            webinar: webinarId,
            product: product.id,
            price: product.price,
            adminId,
            // Add any other default fields needed for an enrollment document
          });
        }
      });
    });

    if (potentialEnrollments.length === 0) {
      console.log('No potential enrollments generated from tags.');
      return []; // Return empty array if nothing to process
    }

    // 1. Identify the unique combinations of attendee and product from the potential list
    // These are the combinations we need to check for existence
    const combinationsToCheck = potentialEnrollments.map((e) => ({
      attendee: e.attendee,
      product: e.product, // This should be the ObjectId
    }));

    // 2. Query the database for existing enrollments matching the webinar and any of these combinations
    // Using $or allows us to check multiple (attendee, product) pairs in one query
    const existingEnrollments = await this.enrollmentModel
      .find({
        webinar: webinarId,
        $or: combinationsToCheck, 
      })
      .exec(); // Add .exec() if you are using Mongoose promises

    // 3. Create a Set of existing enrollment keys for quick lookup
    // A key will be a combination of attendee email and product ID string
    const existingEnrollmentKeys = new Set(
      existingEnrollments.map(
        (enrollment) =>
          `${enrollment.attendee}_${enrollment.product.toString()}`, // Convert ObjectId to string for key
      ),
    );

    // 4. Filter the potential enrollments list
    // Keep only those whose (attendee, product) combination is NOT in the existing set
    const enrollmentsToInsert = potentialEnrollments.filter((enrollment) => {
      const key = `${enrollment.attendee}_${enrollment.product.toString()}`; // Convert ObjectId to string for key
      return !existingEnrollmentKeys.has(key);
    });

    // 5. Insert the filtered list of new enrollments
    if (enrollmentsToInsert.length > 0) {
      console.log(`Inserting ${enrollmentsToInsert.length} new enrollments.`);
      try {
    console.log(enrollmentsToInsert);
        // Assuming enrollmentModel is a Mongoose model with insertMany
        const result =
          await this.enrollmentModel.insertMany(enrollmentsToInsert, { session });
        console.log(`Successfully inserted ${result.length} enrollments.`);
        return result; // Return the documents that were successfully inserted
      } catch (error) {
        console.error('Error inserting enrollments:', error);
        // Handle the error appropriately, perhaps re-throw or return null/empty array
        throw error; // Re-throw the error to be handled by the caller
      }
    } else {
      console.log(
        'All potential enrollments already exist. Nothing new to insert.',
      );
      return []; // Return empty array if no new enrollments were inserted
    }
  }
  // } // End of example class

  async createEnrollment(
    createEnrollmentDto: CreateEnrollmentDto,
    assignedBy?: string,
  ): Promise<any> {
    const product = await this.productsService.getProduct(
      new Types.ObjectId(`${createEnrollmentDto.product}`),
    );
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const pipeline = {
      webinar: new Types.ObjectId(`${createEnrollmentDto.webinar}`),
      attendee: createEnrollmentDto.attendee,
      product: new Types.ObjectId(`${createEnrollmentDto.product}`),
    };
    const isExist = await this.enrollmentModel.findOne(pipeline);

    if (isExist) throw new NotAcceptableException('Enrollment already exists');

    const result = await this.enrollmentModel.create({
      ...createEnrollmentDto,
      price: product.price,
      assignedBy: mongoose.isValidObjectId(assignedBy)
        ? new Types.ObjectId(`${assignedBy}`)
        : undefined,
      assignType: assignedBy ? AssignType.MANUAL : AssignType.AUTO,
    });

    const { createdBy, webinarName, productName } = createEnrollmentDto;

    if (createdBy && webinarName && productName) {
      this.attendeeLogService.createSingleAttendeeLog({
        attendee: result.attendee,
        item: '',
        action: AttendeeAction.Enrollment_CREATED,
        details: `<span>Enrollment created by <strong>${createdBy}</strong> for the webinar : <strong>${webinarName}</strong> and product : <strong>${productName}</strong>.</span>`,
        adminId: new Types.ObjectId(`${createEnrollmentDto.adminId}`),
      });
    }
    return result;
  }

  async getEnrollment(
    adminId: string,
    webinar: string,
    page: number,
    limit: number,
  ): Promise<any> {
    const skip = (page - 1) * limit;

    const pipeline: PipelineStage[] = [
      {
        $match: {
          webinar: new Types.ObjectId(`${webinar}`),
          adminId: new Types.ObjectId(`${adminId}`),
        },
      },
      {
        $lookup: {
          from: 'webinars',
          localField: 'webinar',
          foreignField: '_id',
          as: 'webinar',
        },
      },
      {
        $lookup: {
          from: 'attendees',
          let: { email: '$attendee' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$email', '$$email'] },
                    { $eq: ['$webinar', new Types.ObjectId(`${webinar}`)] },
                  ],
                },
              },
            },
          ],
          as: 'attendee',
        },
      },
      {
        $lookup: {
          from: 'products',
          localField: 'product',
          foreignField: '_id',
          as: 'product',
        },
      },
      { $unwind: '$webinar' },
      { $unwind: '$attendee' },
      {
        $addFields: {
          attendee: '$attendee.email',
          attendeeId: '$attendee._id',
        },
      },
      { $unwind: '$product' },
      {
        $project: {
          _id: 1,
          webinar: {
            _id: 1,
            webinarName: 1,
            webinarDate: 1,
            createdAt: 1,
            updatedAt: 1,
          },
          attendee: 1,
          attendeeId: 1,
          product: {
            _id: 1,
            name: 1,
            level: 1,
            price: 1,
            createdAt: 1,
            updatedAt: 1,
          },
          status: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      },
      { $sort: { updatedAt: -1 } },
      { $skip: skip },
      { $limit: limit },
    ];

    const totalEnrollments = await this.enrollmentModel.countDocuments({
      webinar: new Types.ObjectId(`${webinar}`),
      adminId: new Types.ObjectId(`${adminId}`),
    });

    const totalPages = Math.ceil(totalEnrollments / limit);

    const result = await this.enrollmentModel.aggregate(pipeline);
    return { page, totalPages, result };
  }

  async getAttendeeEnrollments(
    adminId: string,
    attendeeEmail: string,
    page: number,
    limit: number,
  ): Promise<any> {
    const skip = (page - 1) * limit;

    const pipeline = {
      attendee: attendeeEmail,
      adminId: new Types.ObjectId(`${adminId}`),
    };

    const totalEnrollments =
      await this.enrollmentModel.countDocuments(pipeline);

    const totalPages = Math.ceil(totalEnrollments / limit);

    const result = await this.enrollmentModel
      .find(pipeline)
      .populate('webinar attendee product')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit);
    return { page, totalPages, result };
  }

  async updateEnrollment(
    id: string,
    adminId: string,

    updateEnrollmentDto: UpdateEnrollmentDto,
  ): Promise<any> {
    const result = await this.enrollmentModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(`${id}`),
        adminId: new Types.ObjectId(`${adminId}`),
      },
      updateEnrollmentDto,
      { new: true },
    );
    return result;
  }

  async deleteEnrollment(id: string, adminId: string): Promise<any> {
    const result = await this.enrollmentModel.findOneAndDelete({
      _id: new Types.ObjectId(`${id}`),
      adminId: new Types.ObjectId(`${adminId}`),
    });
    return result;
  }

  async checkProductAssociation(id: string): Promise<any> {
    const result = await this.enrollmentModel.findOne({
      product: new Types.ObjectId(`${id}`),
    });
    return result;
  }

  async getProductLevelCounts(adminId: string, email: string) {
    const pipeline: PipelineStage[] = [
      {
        $match: {
          adminId: new Types.ObjectId(`${adminId}`),
          attendee: email,
        },
      },
      {
        $lookup: {
          from: 'products',
          localField: 'product',
          foreignField: '_id',
          as: 'product',
        },
      },
      {
        $unwind: {
          path: '$product',
        },
      },
      
    ];

    const result = await this.enrollmentModel.aggregate(pipeline);
    return result;
  }

    async getEnrollmentsByProductLevel(
    adminId: string,
    email: string,
    productLevel: number,
  ) {
    const pipeline: PipelineStage[] = [
      {
        $match: {
          adminId: new Types.ObjectId(`${adminId}`),
          attendee: email,
        },
      },
      {
        $lookup: {
          from: 'products',
          localField: 'product',
          foreignField: '_id',
          as: 'product',
        },
      },
      {
        $unwind: {
          path: '$product',
        },
      },
      {
        $match: {
          $expr: {
            $eq: ['$product.level', productLevel],
          },
        },
      },
      {
        $lookup: {
          from: 'webinars',
          localField: 'webinar',
          foreignField: '_id',
          as: 'webinar',
        },
      },
      {
        $unwind: {
          path: '$webinar',
        },
      },
      {
        $project: {
          _id: 1,
          webinarName: '$webinar.webinarName',
          webinarDate: '$webinar.webinarDate',
          productName: '$product.name',
          productLevel: '$product.level',
          productPrice: '$product.price',
          enrollmentDate: '$createdAt',
        },
      },
      {
        $sort: {
          enrollmentDate: -1,
        },
      },
    ];

    const result = await this.enrollmentModel.aggregate(pipeline);
    return result;
  }

  async getEnrollmentsByEmail(
    adminId: string,
    email: string,
  ) {
    const pipeline: PipelineStage[] = [
      {
        $match: {
          adminId: new Types.ObjectId(`${adminId}`),
          attendee: email,
        },
      },
      {
        $lookup: {
          from: 'products',
          localField: 'product',
          foreignField: '_id',
          as: 'product',
        },
      },
      {
        $unwind: {
          path: '$product',
        },
      },
      {
        $lookup: {
          from: 'webinars',
          localField: 'webinar',
          foreignField: '_id',
          as: 'webinar',
        },
      },
      {
        $unwind: {
          path: '$webinar',
        },
      },
     {
      $lookup: {
        from: 'users',
        localField: 'assignedBy',
        foreignField: '_id',
        as: 'assignedByUser', // ✅ avoid name conflict
      },
    },
    {
      $unwind: {
        path: '$assignedByUser',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'roles',
        localField: 'assignedByUser.role',
        foreignField: '_id',
        as: 'userRole'
      },
    },
    {
      $unwind: {
        path: '$userRole',
        preserveNullAndEmptyArrays: true,
      },
    },
      {
        $project: {
          _id: 1,
          webinarName: '$webinar.webinarName',
          webinarDate: '$webinar.webinarDate',
          productName: '$product.name',
          productLevel: '$product.level',
          productPrice: '$price',
          assignedBy: '$assignedByUser.userName',
          assignType : '$assignType',
          enrollmentDate: '$createdAt',
          userRole : "$userRole.name"
        },
      },
      {
        $sort: {
          enrollmentDate: -1,
        },
      },
    ];

    const result = await this.enrollmentModel.aggregate(pipeline);
    return result;
  }

  async getEnrollmentByWebinarAndAttendee(
    adminId: string,
    webinar: string,
    attendee: string,
    product: string,
  ) {
    const result = await this.enrollmentModel.findOne({
      adminId: new Types.ObjectId(`${adminId}`),
      webinar: new Types.ObjectId(`${webinar}`),
      attendee: attendee,
      product: new Types.ObjectId(`${product}`),
    });
    return result;
  }

  async getEnrollmentsByLevelOrProduct(
    productData: EnrollmentsByLevelOrProductDTO,
    adminId: string,
  ) {
    const page = parseInt(productData.page) || 1;
    const limit = parseInt(productData.limit) || 10;
    const level = parseInt(productData.productLevel) || undefined;

    console.log(page, limit, level, productData);
    const skip = (page - 1) * limit;

    const basePipeline: PipelineStage[] = [
      {
        $match: {
          adminId: new Types.ObjectId(`${adminId}`),
        },
      },
      {
        $lookup: {
          from: 'products',
          localField: 'product',
          foreignField: '_id',
          as: 'productData',
        },
      },
      { $unwind: '$productData' },
      {
        $match: {
          ...(isNaN(level)
            ? {}
            : {
                'productData.level': level,
              }),
          ...(productData?.productId
            ? {
                'productData._id': new Types.ObjectId(productData?.productId),
              }
            : {}),
        },
      },
      {
        $sort: {
          attendee: 1,
        },
      },
    ];
    const countPipeline: PipelineStage[] = [
      ...basePipeline,
      { $count: 'total' },
    ];
    const mainPipeline: PipelineStage[] = [
      ...basePipeline,
      {
        $skip: skip,
      },
      {
        $limit: limit,
      },
      {
        $lookup: {
          from: 'webinars',
          localField: 'webinar',
          foreignField: '_id',
          as: 'webinarDetails',
        },
      },
      { $unwind: '$webinarDetails' },
      {
        $project: {
          attendee: 1,
          webinarName: '$webinarDetails.webinarName',
          productName: '$productData.name',
          productLevel: '$productData.level',
          createdAt: 1,
          price: 1,
        },
      },
    ];

    const [countResult, mainResult] = await Promise.all([
      this.enrollmentModel.aggregate(countPipeline).exec(),
      this.enrollmentModel.aggregate(mainPipeline).exec(),
    ]);
    const total = countResult[0]?.total || 0;
    const totalPages = Math.ceil(total / limit) || 1;
    const pagination = { page, totalPages, total };
    console.log(pagination, limit);
    return { data: mainResult || [], pagination };
  }

  async deleteEnrollmentsByWebinar(
    session: ClientSession,
    adminId: Types.ObjectId,
    webinarId: Types.ObjectId,
    attendees?: string[],
  ) {
    return this.enrollmentModel
      .deleteMany({
        adminId: adminId,
        webinar: webinarId,
        ...(attendees && { attendee: { $in: attendees } }),
      })
      .session(session)
      .exec();
  }

  async deleteEnrollmentsByAttendeeIds(
    session: ClientSession,
    adminId: Types.ObjectId,
    attendees: string[],
  ) {
    console.log('enrollments -> deleted');
    return this.enrollmentModel
      .deleteMany({
        adminId: adminId,
        attendee: { $in: attendees },
      })
      .session(session)
      .exec();
  }
}
