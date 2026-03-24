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
import mongoose, { ClientSession, Model, PipelineStage, Types } from 'mongoose';
import { AssignType, Enrollment } from 'src/schemas/Enrollments.schema';
import {
  BulkWebinarEnrollmentDto,
  CreateEnrollmentDto,
  EnrollmentsByLevelOrProductDTO,
  UpdateEnrollmentDto,
} from './dto/enrollment.dto';
import { ProductsService } from 'src/products/products.service';
import { AttendeeLogService } from 'src/attendee-log/attendee-log.service';
import { AttendeeAction } from 'src/schemas/attendee-logs.schema';
import { WebinarService } from 'src/webinar/webinar.service';
import { ValidationUtil } from 'src/common/utils/validation.util';
import { AttendeesService } from 'src/attendees/attendees.service';

@Injectable()
export class EnrollmentsService {
  private readonly logger = new Logger(EnrollmentsService.name);

  constructor(
    @InjectModel(Enrollment.name)
    private readonly enrollmentModel: Model<Enrollment>,
    @Inject(forwardRef(() => ProductsService))
    private readonly productsService: ProductsService,
    private readonly attendeeLogService: AttendeeLogService,
    @Inject(forwardRef(() => WebinarService))
    private readonly webinarService: WebinarService,
    @Inject(forwardRef(() => AttendeesService))
    private readonly attendeesService: AttendeesService,
  ) {}

  async createEnrollments(
    tagsData: {
      email: string;
      tags: string[];
    }[],
    webinarId: Types.ObjectId,
    adminId: Types.ObjectId,
    session: ClientSession,
    checkExistingEnrollments: boolean = true,
  ): Promise<Enrollment[]> {
    // Validate input parameters
    if (!tagsData || !Array.isArray(tagsData) || tagsData.length === 0) {
      this.logger.warn('createEnrollments called with empty or invalid tagsData');
      return [];
    }

    if (!webinarId || !Types.ObjectId.isValid(webinarId)) {
      this.logger.error('Invalid webinarId provided to createEnrollments');
      throw new BadRequestException('Invalid webinar ID');
    }

    if (!adminId || !Types.ObjectId.isValid(adminId)) {
      this.logger.error('Invalid adminId provided to createEnrollments');
      throw new BadRequestException('Invalid admin ID');
    }

    // Fetch webinar with error handling
    let webinar;
    try {
      webinar = await this.webinarService.getAssignedProducts(webinarId);
    } catch (error) {
      this.logger.error(
        `Error fetching webinar ${webinarId}: ${error.message}`,
        error.stack,
      );
      throw new NotFoundException(`Webinar not found: ${webinarId}`);
    }

    if (
      !webinar ||
      !Array.isArray(webinar.productIds) ||
      webinar.productIds.length === 0
    ) {
      this.logger.warn(
        `Webinar ${webinarId} has no products assigned or invalid structure`,
      );
      return [];
    }

    // Validate and normalize tagsData
    const validatedTagsData: { email: string; tags: string[] }[] = [];
    for (const item of tagsData) {
      // Validate email
      if (!item.email || typeof item.email !== 'string') {
        this.logger.warn(`Skipping item with invalid email: ${item.email}`);
        continue;
      }

      try {
        const normalizedEmail = ValidationUtil.validateEmail(item.email);
        // Validate tags array
        if (!Array.isArray(item.tags) || item.tags.length === 0) {
          this.logger.debug(
            `Skipping ${normalizedEmail} - no tags provided`,
          );
          continue;
        }

        // Filter and validate tags
        const validTags = item.tags
          .filter(
            (tag) =>
              typeof tag === 'string' && tag.trim() !== '',
          )
          .map((tag) => tag.trim().toLowerCase());

        if (validTags.length === 0) {
          this.logger.debug(
            `Skipping ${normalizedEmail} - no valid tags after filtering`,
          );
          continue;
        }

        validatedTagsData.push({
          email: normalizedEmail,
          tags: validTags,
        });
      } catch (error) {
        this.logger.warn(
          `Skipping invalid email "${item.email}": ${error.message}`,
        );
        continue;
      }
    }

    if (validatedTagsData.length === 0) {
      this.logger.warn('No valid tagsData after validation');
      return [];
    }

    // Build product map with validation
    interface ProductInfo {
      id: Types.ObjectId;
      price: number;
    }

    const products: Array<{
      _id: Types.ObjectId;
      tag: string;
      price: number;
    }> = webinar.productIds;

    const productMap = new Map<string, ProductInfo>();
    for (const product of products) {
      if (
        !product ||
        !product._id ||
        !Types.ObjectId.isValid(product._id) ||
        typeof product.tag !== 'string' ||
        product.tag.trim() === ''
      ) {
        this.logger.debug('Skipping product with invalid tag or ID');
        continue;
      }

      // Validate price
      const price =
        typeof product.price === 'number' && product.price >= 0
          ? product.price
          : 0;

      productMap.set(product.tag.toLowerCase().trim(), {
        id: product._id,
        price,
      });
    }

    if (productMap.size === 0) {
      this.logger.warn('No valid products found after validation');
      return [];
    }

    // Generate potential enrollments with deduplication
    interface PotentialEnrollment {
      attendee: string;
      webinar: Types.ObjectId;
      product: Types.ObjectId;
      price: number;
      adminId: Types.ObjectId;
      assignType: AssignType;
    }

    const enrollmentKeySet = new Set<string>();
    const potentialEnrollments: PotentialEnrollment[] = [];

    for (const item of validatedTagsData) {
      const attendeeEmail = item.email;
      const attendeeTags = [...new Set(item.tags)]; // Remove duplicate tags

      for (const tag of attendeeTags) {
        if (productMap.has(tag)) {
          const product = productMap.get(tag)!;
          const key = `${attendeeEmail}_${product.id.toString()}`;

          // Prevent duplicate enrollments in the same batch
          if (!enrollmentKeySet.has(key)) {
            enrollmentKeySet.add(key);
            potentialEnrollments.push({
              attendee: attendeeEmail,
              webinar: webinarId,
              product: product.id,
              price: product.price,
              adminId,
              assignType: AssignType.AUTO,
            });
          }
        }
      }
    }

    if (potentialEnrollments.length === 0) {
      this.logger.debug('No potential enrollments generated from tags');
      return [];
    }

    // Check for existing enrollments
    let existingEnrollments: Enrollment[] = [];

    if (checkExistingEnrollments) {
      // Normalize emails in combinationsToCheck for case-insensitive comparison
      const combinationsToCheck = potentialEnrollments.map((e) => ({
        attendee: e.attendee.toLowerCase(),
        product: e.product,
      }));

      try {
        existingEnrollments = await this.enrollmentModel
          .find({
            webinar: webinarId,
            $or: combinationsToCheck,
          })
          .exec();

        // Normalize existing enrollment emails for comparison
        existingEnrollments = existingEnrollments.map((enrollment) => ({
          ...enrollment.toObject(),
          attendee: enrollment.attendee.toLowerCase(),
        })) as Enrollment[];
      } catch (error) {
        this.logger.error(
          `Error checking existing enrollments: ${error.message}`,
          error.stack,
        );
        throw error;
      }
    }

    // Create a Set of existing enrollment keys (normalized emails)
    const existingEnrollmentKeys = new Set(
      existingEnrollments.map(
        (enrollment) =>
          `${enrollment.attendee.toLowerCase()}_${enrollment.product.toString()}`,
      ),
    );

    // Filter out existing enrollments
    const enrollmentsToInsert = potentialEnrollments.filter((enrollment) => {
      const key = `${enrollment.attendee.toLowerCase()}_${enrollment.product.toString()}`;
      return !existingEnrollmentKeys.has(key);
    });

    // Log duplicate count if duplicates were found
    const duplicateCount = potentialEnrollments.length - enrollmentsToInsert.length;
    if (duplicateCount > 0) {
      this.logger.log(
        `${duplicateCount}/${potentialEnrollments.length} enrollments already exist`,
      );
    }

    // Insert new enrollments
    if (enrollmentsToInsert.length > 0) {
      this.logger.log(
        `Inserting ${enrollmentsToInsert.length} new enrollments for webinar ${webinarId}`,
      );
      try {
        const result = await this.enrollmentModel.insertMany(
          enrollmentsToInsert,
          { session },
        );
        this.logger.log(
          `Successfully inserted ${result.length} enrollments`,
        );
        return result;
      } catch (error) {
        this.logger.error(
          `Error inserting enrollments: ${error.message}`,
          error.stack,
        );
        throw error;
      }
    } else {
      this.logger.debug(
        'All potential enrollments already exist. Nothing new to insert.',
      );
      return [];
    }
  }

  async createUpdateEnrollments(
    tagsData: {
      email: string;
      tags: string[];
    }[],
    webinarId: Types.ObjectId,
    adminId: Types.ObjectId,
    session: ClientSession,
  ): Promise<any[]> {
    // Adjust return type based on insertMany result

    await this.enrollmentModel.deleteMany(
      {
        attendee: {
          $in: tagsData.map((item) => item.email),
        },
        webinar: webinarId,
        adminId,
      },
      {
        session,
      },
    );

    return await this.createEnrollments(
      tagsData,
      webinarId,
      adminId,
      session,
      false,
    );
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

    if (webinarName && productName) {
      this.attendeeLogService.createSingleAttendeeLog({
        attendee: result.attendee,
        item: '',
        action: AttendeeAction.Enrollment_CREATED,
        details: `<span>Enrollment created by <strong>${createdBy ? createdBy : 'API'}</strong> for the webinar : <strong>${webinarName}</strong> and product : <strong>${productName}</strong>.</span>`,
        adminId: new Types.ObjectId(`${createEnrollmentDto.adminId}`),
      });
    }
    return result;
  }

  async bulkCreateEnrollmentsForWebinar(
    body: BulkWebinarEnrollmentDto,
    adminId: string,
  ): Promise<{
    createdCount: number;
    skippedExisting: number;
    totalCandidates: number;
  }> {
    const webinarId = new Types.ObjectId(body.webinarId);
    const productId = new Types.ObjectId(body.productId);
    const adminObjectId = new Types.ObjectId(adminId);

    const product = await this.productsService.getProduct(productId);
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    const price =
      typeof product.price === 'number' && product.price >= 0
        ? product.price
        : 0;

    let emails: string[] = [];
    if (body.scope === 'selected' && body.attendeeIds?.length) {
      emails = await this.attendeesService.getAttendeeEmailsByIds(
        body.attendeeIds,
        body.webinarId,
        adminId,
        body.isAttended,
      );
    } else if (body.scope === 'filtered') {
      const result = await this.attendeesService.getAttendees(
        body.webinarId,
        adminId,
        body.isAttended,
        1,
        1000000,
        {
          filters: body.filters || {},
          validCall: body.validCall,
          assignmentType: body.assignmentType,
        },
        false,
      );
      const raw = (Array.isArray(result) ? result : [])
        .map((a: any) => a?.email)
        .filter(
          (email: any): email is string =>
            typeof email === 'string' && email.trim().length > 0,
        );
      emails = Array.from(
        new Set(raw.map((e: string) => e.toLowerCase().trim())),
      );
    }

    if (emails.length === 0) {
      return {
        createdCount: 0,
        skippedExisting: 0,
        totalCandidates: 0,
      };
    }

    const potentialEnrollments = emails.map((attendee) => ({
      attendee,
      webinar: webinarId,
      product: productId,
      price,
      adminId: adminObjectId,
      assignType: AssignType.MANUAL,
    }));

    const EXISTING_CHECK_BATCH = 1000;
    const INSERT_BATCH = 5000;

    const session = await this.enrollmentModel.startSession();
    let createdCount = 0;
    let skippedExisting = 0;

    try {
      await session.withTransaction(async (currentSession) => {
        const existingKeys = new Set<string>();

        // Batch existing-enrollment check by attendee chunks
        for (let i = 0; i < emails.length; i += EXISTING_CHECK_BATCH) {
          const chunk = emails.slice(i, i + EXISTING_CHECK_BATCH);
          const existing = await this.enrollmentModel
            .find({
              webinar: webinarId,
              product: productId,
              attendee: { $in: chunk },
            })
            .select('attendee product')
            .session(currentSession)
            .lean()
            .exec();

          for (const e of existing || []) {
            const key = `${String(e.attendee || '').toLowerCase()}_${String(
              e.product || '',
            )}`;
            existingKeys.add(key);
          }
        }

        const toInsert = potentialEnrollments.filter((e) => {
          const key = `${e.attendee.toLowerCase()}_${e.product.toString()}`;
          return !existingKeys.has(key);
        });

        if (toInsert.length === 0) {
          createdCount = 0;
          skippedExisting = potentialEnrollments.length;
          return;
        }

        skippedExisting = potentialEnrollments.length - toInsert.length;

        // Insert new enrollments in batches within the same transaction
        for (let i = 0; i < toInsert.length; i += INSERT_BATCH) {
          const chunk = toInsert.slice(i, i + INSERT_BATCH);
          const inserted = await this.enrollmentModel.insertMany(chunk, {
            session: currentSession,
          });
          createdCount += inserted.length;
        }
      });
    } finally {
      await session.endSession();
    }

    return {
      createdCount,
      skippedExisting,
      totalCandidates: emails.length,
    };
  }

  async getEnrollment(
    adminId: string,
    webinar: string,
    page: number,
    limit: number,
    productId?: Types.ObjectId,
  ): Promise<any> {
    const skip = (page - 1) * limit;

    const webinarObjectId = new Types.ObjectId(`${webinar}`);
    const adminObjectId = new Types.ObjectId(`${adminId}`);
    const productMatch = productId ? { product: productId } : {};

    const mainPipeline: PipelineStage[] = [
      {
        $match: {
          webinar: webinarObjectId,
          adminId: adminObjectId,
          ...productMatch,
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
                    { $eq: ['$webinar', webinarObjectId] },
                  ],
                },
              },
            },
          ],
          as: 'attendeeDetails',
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
      { $unwind: '$product' },
      {
        $lookup: {
          from: 'users',
          localField: 'assignedBy',
          foreignField: '_id',
          as: 'assignedByUser',
        },
      },
      {
        $unwind: {
          path: '$assignedByUser',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          _id: 1,
          webinarName: '$webinar.webinarName',
          webinarId: '$webinar._id',
          attendee: {
            $arrayElemAt: ['$attendeeDetails.email', 0],
          },
          attendeeId: {
            $arrayElemAt: ['$attendeeDetails._id', 0],
          },
          productName: '$product.name',
          productLevel: '$product.level',
          productId: '$product._id',
          price: 1,
          status: 1,
          createdAt: 1,
          updatedAt: 1,
          assignedBy: '$assignedByUser.userName',
          role: '$assignedByUser.role',
          assignType: 1,
        },
      },
      { $sort: { updatedAt: -1 } },
      { $skip: skip },
      { $limit: limit },
    ];

    const revenuePipeline: PipelineStage[] = [
      {
        $match: {
          webinar: webinarObjectId,
          adminId: adminObjectId,
          ...productMatch,
        },
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$price' },
        },
      },
    ];

    const [result, totalEnrollments, revenueResult] = await Promise.all([
      this.enrollmentModel.aggregate(mainPipeline),
      this.enrollmentModel.countDocuments({
        webinar: webinarObjectId,
        adminId: adminObjectId,
        ...productMatch,
      }),
      this.enrollmentModel.aggregate(revenuePipeline),
    ]);

    const totalPages = Math.ceil(totalEnrollments / limit);
    const totalRevenue =
      revenueResult.length > 0 ? revenueResult[0].totalRevenue : 0;

    return { page, totalPages, result, totalEnrollments, totalRevenue };
  }
  // async getAttendeeEnrollments(
  //   adminId: string,
  //   attendeeEmail: string,
  //   page: number,
  //   limit: number,
  // ): Promise<any> {
  //   const skip = (page - 1) * limit;
  //   const pipeline = {
  //     attendee: attendeeEmail,
  //     adminId: new Types.ObjectId(`${adminId}`),
  //   };
  //   const totalEnrollments =
  //     await this.enrollmentModel.countDocuments(pipeline);
  //   const totalPages = Math.ceil(totalEnrollments / limit);
  //   const result = await this.enrollmentModel
  //     .find(pipeline)
  //     .populate('webinar attendee product')
  //     .sort({ updatedAt: -1 })
  //     .skip(skip)
  //     .limit(limit);
  //   return { page, totalPages, result };
  // }

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

  // async getProductLevelCounts(adminId: string, email: string) {
  //   const pipeline: PipelineStage[] = [
  //     {
  //       $match: {
  //         adminId: new Types.ObjectId(`${adminId}`),
  //         attendee: email,
  //       },
  //     },
  //     {
  //       $lookup: {
  //         from: 'products',
  //         localField: 'product',
  //         foreignField: '_id',
  //         as: 'product',
  //       },
  //     },
  //     {
  //       $unwind: {
  //         path: '$product',
  //       },
  //     },
  //   ];

  //   const result = await this.enrollmentModel.aggregate(pipeline);
  //   return result;
  // }

  // async getEnrollmentsByProductLevel(
  //   adminId: string,
  //   email: string,
  //   productLevel: number,
  // ) {
  //   const pipeline: PipelineStage[] = [
  //     {
  //       $match: {
  //         adminId: new Types.ObjectId(`${adminId}`),
  //         attendee: email,
  //       },
  //     },
  //     {
  //       $lookup: {
  //         from: 'products',
  //         localField: 'product',
  //         foreignField: '_id',
  //         as: 'product',
  //       },
  //     },
  //     {
  //       $unwind: {
  //         path: '$product',
  //       },
  //     },
  //     {
  //       $match: {
  //         $expr: {
  //           $eq: ['$product.level', productLevel],
  //         },
  //       },
  //     },
  //     {
  //       $lookup: {
  //         from: 'webinars',
  //         localField: 'webinar',
  //         foreignField: '_id',
  //         as: 'webinar',
  //       },
  //     },
  //     {
  //       $unwind: {
  //         path: '$webinar',
  //       },
  //     },
  //     {
  //       $project: {
  //         _id: 1,
  //         webinarName: '$webinar.webinarName',
  //         webinarDate: '$webinar.webinarDate',
  //         productName: '$product.name',
  //         productLevel: '$product.level',
  //         productPrice: '$price',
  //         enrollmentDate: '$createdAt',
  //       },
  //     },
  //     {
  //       $sort: {
  //         enrollmentDate: -1,
  //       },
  //     },
  //   ];

  //   const result = await this.enrollmentModel.aggregate(pipeline);
  //   return result;
  // }

  async getEnrollmentsByEmail(adminId: string, email: string) {
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
          as: 'userRole',
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
          assignType: '$assignType',
          enrollmentDate: '$createdAt',
          userRole: '$userRole.name',
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
    const level = parseInt(productData.productLevel)
      ? parseInt(productData.productLevel)
      : parseInt(productData.productLevel) === 0
        ? 0
        : undefined;
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
    return this.enrollmentModel
      .deleteMany({
        adminId: adminId,
        attendee: { $in: attendees },
      })
      .session(session)
      .exec();
  }
}
