import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotAcceptableException,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  ClientSession,
  Connection,
  Model,
  PipelineStage,
  Types,
} from 'mongoose';
import {
  Assignments,
  AssignmentStatus,
  RecordType,
} from 'src/schemas/Assignments.schema';
import {
  AssignmentDto,
  MoveToPullbacksDTO,
  ReAssignmentDTO,
} from './dto/Assignment.dto';
import { ConfigService } from '@nestjs/config';
import {
  AttendeesFilterDto,
  CreateAttendeeDto,
  SortOrder,
  WebinarAttendeesSortBy,
  WebinarAttendeesSortObject,
} from 'src/attendees/dto/attendees.dto';
import { Attendee } from 'src/schemas/Attendee.schema';
import { WebinarService } from 'src/webinar/webinar.service';
import { SubscriptionService } from 'src/subscription/subscription.service';
import { AttendeesService } from 'src/attendees/attendees.service';
import { UsersService } from 'src/users/users.service';
import { NotificationService } from 'src/notification/notification.service';
import {
  notificationActionType,
  notificationType,
} from 'src/schemas/notification.schema';
import { TagsService } from 'src/tags/tags.service';
import { Usecase } from 'src/schemas/tags.schema';
import { EnrollmentsService } from 'src/enrollments/enrollments.service';
import { AttendeeLogService } from 'src/attendee-log/attendee-log.service';
import { AttendeeAction } from 'src/schemas/attendee-logs.schema';
import { User } from 'src/schemas/User.schema';
import { Webinar } from 'src/schemas/Webinar.schema';

@Injectable()
export class AssignmentService {
  constructor(
    @InjectModel(Assignments.name) private assignmentsModel: Model<Assignments>,
    @InjectConnection() private readonly mongoConnection: Connection,

    private readonly configService: ConfigService,
    private readonly notificationService: NotificationService,
    @Inject(forwardRef(() => WebinarService))
    private readonly webinarService: WebinarService,
    @Inject(forwardRef(() => SubscriptionService))
    private readonly subscriptionService: SubscriptionService,
    @Inject(forwardRef(() => AttendeesService))
    private readonly attendeeService: AttendeesService,
    @Inject(forwardRef(() => UsersService))
    private readonly userService: UsersService,
    private readonly tagsService: TagsService,
    private readonly enrollmentService: EnrollmentsService,
    private readonly attendeeLogService: AttendeeLogService,
  ) { }

  async getAssignments(
    adminId: string,
    id: string,
    page: number,
    limit: number,
    filters: AttendeesFilterDto = {},
    webinarId: string = '',
    validCall: string = '',
    assignmentStatus: AssignmentStatus,
    sort: WebinarAttendeesSortObject = {
      sortBy: WebinarAttendeesSortBy.EMAIL,
      sortOrder: SortOrder.ASC,
    },
  ): Promise<any> {
    const skip = (page - 1) * limit;
    const basePipeline: PipelineStage[] = [
      {
        $match: {
          adminId: new Types.ObjectId(adminId),
          ...(id && { user: new Types.ObjectId(id) }),
          ...(webinarId && { webinar: new Types.ObjectId(webinarId) }),
          status: assignmentStatus,
        },
      },
      {
        $lookup: {
          from: 'attendees',
          localField: 'attendee',
          foreignField: '_id',
          as: 'attendee',
        },
      },
      {
        $unwind: {
          path: '$attendee',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          attendeeId: '$attendee._id',
          email: '$attendee.email',
          firstName: '$attendee.firstName',
          lastName: '$attendee.lastName',
          isAttended: '$attendee.isAttended',
          validCall: '$attendee.validCall',
          gender: '$attendee.gender',
          location: '$attendee.location',
          phone: '$attendee.phone',
          status: '$attendee.status',
          timeInSession: '$attendee.timeInSession',
          webinar: '$attendee.webinar',
          createdAt: '$createdAt',
          tags: '$attendee.tags',
          source: '$attendee.source',
        },
      },
      {
        $match: {
          ...(filters.email && {
            email: { $regex: filters.email, $options: 'i' },
          }),
          ...(filters.firstName && {
            firstName: { $regex: filters.firstName, $options: 'i' },
          }),
          ...(filters.lastName && {
            lastName: { $regex: filters.lastName, $options: 'i' },
          }),
          ...(filters.gender && {
            gender: { $regex: filters.gender, $options: 'i' },
          }),
          ...(filters.phone && {
            phone: { $regex: filters.phone, $options: 'i' },
          }),
          ...(filters.location && {
            location: { $regex: filters.location, $options: 'i' },
          }),
          ...(filters.timeInSession && {
            timeInSession: filters.timeInSession,
          }),
          ...(validCall && {
            ...(validCall === 'Worked'
              ? { status: { $ne: null } }
              : { status: null }),
          }),
          ...(filters.status && {
            status: filters.status,
          }),
          ...(filters.tags && {
            tags: { $in: filters.tags },
          }),
          ...(filters.source && {
            source: { $regex: filters.source, $options: 'i' },
          }),
        },
      },
      ...(filters.leadType
        ? [
          {
            $lookup: {
              from: 'attendeeassociations',
              let: { tempMail: '$email' },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        {
                          $eq: ['$adminId', new Types.ObjectId(`${adminId}`)],
                        },
                        { $eq: ['$email', '$$tempMail'] },
                        {
                          $eq: [
                            '$leadType',
                            new Types.ObjectId(filters.leadType),
                          ],
                        },
                      ],
                    },
                  },
                },
              ],

              as: 'attendeeAssociations',
            },
          },
          {
            $unwind: {
              path: '$attendeeAssociations',
              preserveNullAndEmptyArrays: false,
            },
          },
        ]
        : []),
    ];

    const mainPipeline: PipelineStage[] = [
      ...basePipeline,
      { $sort: { [sort.sortBy]: sort.sortOrder === SortOrder.ASC ? 1 : -1 } },
      { $skip: skip },
      { $limit: limit },
      ...(filters.leadType
        ? []
        : [
          {
            $lookup: {
              from: 'attendeeassociations',
              let: { tempMail: '$email' },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        {
                          $eq: ['$adminId', new Types.ObjectId(`${adminId}`)],
                        },
                        { $eq: ['$email', '$$tempMail'] },
                      ],
                    },
                  },
                },
              ],

              as: 'attendeeAssociations',
            },
          },
          {
            $unwind: {
              path: '$attendeeAssociations',
              preserveNullAndEmptyArrays: true,
            },
          },
        ]),
      {
        $addFields: {
          leadType: '$attendeeAssociations.leadType',
        },
      },
      {
        $project: {
          attendeeAssociations: 0,
        },
      },
    ];

    const [result, totalResult] = await Promise.all([
      this.assignmentsModel.aggregate(mainPipeline).exec(),
      this.assignmentsModel
        .aggregate([...basePipeline, { $count: 'total' }])
        .exec(),
    ]);
    const total = totalResult[0]?.total || 0;

    const pagination = {
      total,
      totalPages: Math.ceil(total / limit),
      page,
      limit,
    };

    return { pagination, result };
  }

  async addAssignment(data: AssignmentDto, adminId: string, employee: User) {
    const attendeeIds = data.attendees.map((a) => new Types.ObjectId(`${a}`));

    const attendeeData = await this.attendeeService.fetchAssigned(attendeeIds);

    if (attendeeData && attendeeData.length > 0) {
      throw new BadRequestException('Attendee already assigned');
    }

    const webinar = await this.webinarService.getWebinarById(data.webinar);

    if (!webinar) {
      throw new NotFoundException('Webinar not found');
    }

    const session = await this.assignmentsModel.startSession();
    try {
      await session.withTransaction(async (currentSession) => {
        const updatedAttendees = await this.attendeeService.updateAttendees(
          {
            _id: { $in: attendeeIds },
            adminId: new Types.ObjectId(`${adminId}`),
          },
          { assignedTo: new Types.ObjectId(`${data.user}`) },
          currentSession,
        );

        if (updatedAttendees.matchedCount !== attendeeIds.length) {
          throw new NotFoundException('Some attendees were not found');
        }

        const newAssignmentsData = attendeeIds.map((attendeeId) => ({
          adminId: new Types.ObjectId(`${adminId}`),
          user: new Types.ObjectId(`${data.user}`),
          webinar: new Types.ObjectId(`${data.webinar}`),
          attendee: attendeeId,
          recordType: data.recordType,
          status: AssignmentStatus.ACTIVE,
        }));

        const createdAssignments = await this.assignmentsModel.insertMany(
          newAssignmentsData,
          { session: currentSession },
        );

        if (
          !createdAssignments ||
          createdAssignments.length !== attendeeIds.length
        ) {
          throw new InternalServerErrorException(
            'Failed to create all new assignments',
          );
        }

        const allAttendeesData =
          await this.attendeeService.fetchAttendees(attendeeIds);

        await this.attendeeLogService.createMultipleAssignmentsLog(
          {
            userName: employee.userName,
            attendees: allAttendeesData,
          },
          webinar.webinarName,
          new Types.ObjectId(adminId),
          currentSession,
          data.recordType === RecordType.POST_WEBINAR,
        );

        await this.userService.incrementCount(
          data.user,
          createdAssignments.length,
          currentSession,
        );
      });
    } catch (error) {
      throw error;
    } finally {
      session.endSession();
    }

    if (attendeeIds.length > 0) {
      const webinar = await this.webinarService.getWebinarById(data.webinar);
      const webinarName = webinar?.webinarName || 'Webinar';
      const notification = {
        recipient: data.user,
        title: 'New Tasks Assigned',
        message: `You have been assigned ${attendeeIds.length} new tasks in ${webinarName}. Please check your task list for details.`,
        type: notificationType.INFO,
        actionType: notificationActionType.ASSIGNMENT,
        metadata: {
          webinarId: data.webinar,
        },
      };

      await this.notificationService.createNotification(notification);
    }

    return { success: true, message: 'Assignment created successfully' };
  }

  formatPhoneNumber(phoneNumber: string) {
    if (!phoneNumber) return '';
    if (phoneNumber.includes('E')) {
      return Number(phoneNumber).toFixed(0);
    }
    const cleanedPhoneNumber = phoneNumber.toString().replace(/[^0-9]/g, '');
    if (cleanedPhoneNumber.length === 12) return cleanedPhoneNumber.slice(2);
    return cleanedPhoneNumber;
  }

  async handleTags(
    attendee: Attendee,
    attendeeEmail: string,
    webinar: Webinar,
    adminId: Types.ObjectId,
    tags: string[],
    assignedProducts: any[] = [],
    assignedEmployees: any[] = [],
  ): Promise<boolean> {
    const webinarId = webinar._id.toString();
    const attendeeId = attendee?._id;

    const existingTags = await this.tagsService.getTags(adminId);
    const tagsUsecaseMap = existingTags.reduce((acc, tag) => {
      acc[tag.name] = tag.usecase;
      return acc;
    }, {});
    let executeFurther = true;

    for (const tag of tags) {
      if (
        tagsUsecaseMap[tag] === Usecase.PRODUCT &&
        Array.isArray(assignedProducts)
      ) {
        assignedProducts
          .filter((product) => product.tag === tag)
          .forEach(async (product) => {
            const existingEnrollment =
              await this.enrollmentService.getEnrollmentByWebinarAndAttendee(
                adminId.toString(),
                webinarId,
                attendeeEmail,
                product._id,
              );
            if (existingEnrollment) {
            } else {
              const enrollment = await this.enrollmentService.createEnrollment({
                attendee: attendeeEmail,
                product: product._id,
                adminId: adminId.toString(),
                webinar: webinarId,
              });
            }
          });
      }

      const taggedEmployee = assignedEmployees.find(
        (employee) =>
          Array.isArray(employee.tags) && employee.tags.includes(tag),
      );
      if (
        executeFurther &&
        taggedEmployee &&
        taggedEmployee.role.toString() ===
        this.configService.get('appRoles').EMPLOYEE_REMINDER &&
        taggedEmployee.dailyContactLimit > taggedEmployee.dailyContactCount
      ) {
        const existingAssignment = await this.assignmentsModel.findOne({
          adminId: adminId,
          webinar: new Types.ObjectId(`${webinarId}`),
          attendee: attendeeId,
          recordType: 'preWebinar',
        });
        if (existingAssignment) {
        } else {
          await this.createNewAssignmentForPreWebinar(
            adminId,
            webinar,
            attendee,
            taggedEmployee,
            'preWebinar',
          );
        }
        executeFurther = false;
      }
    }
    return executeFurther;
  }

  async addPreWebinarAssignments(
    adminId: string,
    webinarId: string,
    attendee: CreateAttendeeDto,
  ) {
    const recordType = 'preWebinar';

    const postWebinarExists = await this.attendeeService.getPostWebinarAttendee(
      webinarId,
      adminId,
    );

    if (postWebinarExists) {
      throw new NotAcceptableException(
        'Cannot add Pre-Webinar data as it already exists in Post-Webinar.',
      );
    }

    // Fetch the webinar details for the given webinar ID and admin ID
    const webinar = await this.webinarService.getWebinar(webinarId, adminId);

    if (!webinar) {
      throw new NotFoundException('Webinar not found.');
    }

    // Fetch the subscription details for the admin
    const subscription =
      await this.subscriptionService.getSubscription(adminId);

    if (!subscription) {
      throw new ForbiddenException('Subscription not found.');
    }

    // Check subscription validity and attendee limits
    if (
      subscription.expiryDate < new Date() || // Subscription expired
      subscription.contactLimit <= subscription.contactCount // Contact limit reached
    ) {
      throw new ForbiddenException(
        'Contact limit reached or subscription expired.',
      );
    }

    // Check if an attendee with the same email is already added to this webinar
    const existingAttendee: Attendee | null =
      await this.attendeeService.fetchAttendeeByWebinar(
        attendee.email,
        webinarId,
      );
    console.log(
      'existingAttendee',
      existingAttendee?.email,
      existingAttendee?.webinar,
    );

    if (existingAttendee) {
      if (
        Array.isArray(existingAttendee.tags) &&
        Array.isArray(attendee.tags)
      ) {
        const newTags = attendee.tags.filter(
          (tag) => !existingAttendee.tags.includes(tag),
        );

        if (existingAttendee.tags.length === 0) {
          existingAttendee.tags = newTags;
        } else {
          existingAttendee.tags = [...existingAttendee.tags, ...newTags];
        }
        await this.handleTags(
          existingAttendee,
          attendee.email,
          webinar,
          new Types.ObjectId(adminId),
          newTags,
          webinar.productIds,
          webinar.assignedEmployees,
        );

        await existingAttendee.save();
      }

      return {
        success: true,
        message: 'Attendee Updated Successfully.',
        data: { existingAttendee },
      };
    }

    const attendeeCount = await this.attendeeService.getNonUniqueAttendeesCount(
      [attendee.email],
      new Types.ObjectId(`${adminId}`),
    );

    if (!attendee.phone) {
      const phoneNumbers = await this.attendeeService.getAttendeePhoneNumbers(
        new Types.ObjectId(`${adminId}`),
        attendee.email,
      );
      if (phoneNumbers.length > 0) {
        attendee.phone = phoneNumbers[0].phone;
      }
    }

    attendee.phone = this.formatPhoneNumber(attendee.phone);

    // Add the attendee to the database
    const newAttendees: Attendee[] | null =
      await this.attendeeService.addAttendees([
        {
          ...attendee,
          source: attendee.source || 'API',
          isAttended: false,
          webinar: new Types.ObjectId(`${webinarId}`),
          adminId: new Types.ObjectId(`${adminId}`),
        },
      ]);

    if (
      !newAttendees ||
      !Array.isArray(newAttendees) ||
      newAttendees.length === 0
    ) {
      throw new InternalServerErrorException('Failed to add attendee.');
    }

    if (attendeeCount === 0) {
      await this.subscriptionService.incrementContactCount(
        subscription._id.toString(),
      );
    }

    const notificationForAdmin = {
      recipient: adminId,
      title: 'New Attendee Registered',
      message: `A new attendee has registered for the webinar ${webinar?.webinarName}. Please check your attendee list for details.`,
      type: notificationType.INFO,
      actionType: notificationActionType.ATTENDEE_REGISTRATION,
      metadata: {
        webinarId,
        isAttended: false,
      },
    };

    setTimeout(() => {
      this.notificationService.createNotification(notificationForAdmin);
    }, 2000);

    const newAttendee = newAttendees[0];

    this.attendeeLogService.createSingleAttendeeLog({
      attendee: newAttendee.email,
      action: AttendeeAction.REGISTERED,
      item: 'Attendee',
      details: `${newAttendee.email} registered for webinar ${webinar?.webinarName}`,
      adminId: new Types.ObjectId(adminId),
    });

    const executeFurther: boolean = await this.handleTags(
      newAttendee,
      newAttendee.email,
      webinar,
      new Types.ObjectId(adminId),
      newAttendee.tags,
      webinar.productIds,
      webinar.assignedEmployees,
    );

    if (!executeFurther) {
      return {
        success: true,
        message: 'Attendee updated successfully',
        data: {},
      };
    }

    // Validate webinar assigned employees
    if (!Array.isArray(webinar.assignedEmployees)) {
      return {
        success: true,
        message:
          'Attendee has been created, Assigned employees for the webinar are missing or invalid.',
        data: { newAttendee },
      };
    }

    // Check if the attendee was previously assigned to an employee
    const lastAssigned = await this.attendeeService.checkPreviousAssignment(
      newAttendee.email,
    );

    // If previously assigned, check if the same employee can be reassigned
    if (lastAssigned && lastAssigned.assignedTo) {
      const isEmployeeAssignedToWebinar = webinar.assignedEmployees.some(
        (employee) => {
          return (
            employee._id.toString() === lastAssigned.assignedTo.toString() &&
            employee.role.toString() ===
            this.configService.get('appRoles')['EMPLOYEE_REMINDER']
          );
        },
      );

      // If the same employee is assigned to this webinar
      if (isEmployeeAssignedToWebinar) {
        const employee = await this.userService.getEmployee(
          lastAssigned.assignedTo.toString(),
        );

        // Validate employee's daily contact limit
        if (
          employee &&
          employee.dailyContactLimit > employee.dailyContactCount
        ) {
          // Create a new assignment
          return this.createNewAssignmentForPreWebinar(
            new Types.ObjectId(`${adminId}`),
            webinar,
            newAttendee,
            employee,
            recordType,
          );
        }
      }
    } else {
      // If no previous assignment, find the next available employee
      const empwithDiff = webinar.assignedEmployees.map((emp) => {
        return {
          ...emp,
          difference: emp.dailyContactLimit - (emp.dailyContactCount || 0), // Calculate remaining capacity
        };
      });
      const filteredEmployee = empwithDiff.filter(
        (emp) =>
          emp.difference > 0 &&
          emp.role.toString() ===
          this.configService.get('appRoles').EMPLOYEE_REMINDER, // Only employees with the correct role and capacity
      );

      const employees = filteredEmployee.sort(
        (a, b) => a.dailyContactCount - b.dailyContactCount,
      ); // Sort by the largest remaining capacity first

      if (employees.length > 0) {
        const employee = employees[0]; // Pick the employee with the smallest remaining capacity

        // Create a new assignment

        return this.createNewAssignmentForPreWebinar(
          new Types.ObjectId(`${adminId}`),
          webinar,
          newAttendee,
          employee,
          recordType,
        );
      } else {
        return {
          success: true,
          message:
            'Attendee has been created, No eligible employees available for assignment.',
          data: { newAttendee },
        };
      }
    }
  }

  async createNewAssignmentForPreWebinar(
    adminId: Types.ObjectId,
    webinar: Webinar,
    newAttendee: Attendee,
    employee: User,
    recordType: string,
  ) {
    const employeeId = employee._id;
    const webinarId = webinar._id;
    const newAssignment = await this.assignmentsModel.create({
      adminId,
      webinar: webinarId,
      attendee: newAttendee._id,
      user: employeeId,
      recordType,
    });
    if (!newAssignment) {
      return {
        success: true,
        message: 'Failed to create assignment.',
        data: { newAttendee },
      };
    }

    // Increment the employee's daily contact count
    const isIncremented = await this.userService.incrementCount(
      employeeId.toString(),
    );

    if (!isIncremented) {
      return {
        success: true,
        message: 'Failed to update employee contact count.',
        data: { newAttendee, newAssignment },
      };
    }

    const updatedAttendee = await this.attendeeService.updateAttendeeAssign(
      newAttendee._id.toString(),
      employeeId.toString(),
    );
    if (!updatedAttendee) {
      return {
        success: true,
        message: 'Failded to Update Employee Id in attendee Document.',
        data: { newAttendee, newAssignment },
      };
    }

    await this.attendeeLogService.createAssignmentsLog(
      employee.userName,
      newAttendee.email,
      webinar.webinarName,
      new Types.ObjectId(`${adminId}`),
      recordType === RecordType.POST_WEBINAR,
    );

    const notification = {
      recipient: employeeId.toString(),
      title: 'New Task Assigned',
      message: `You have been assigned a new task in webinar ${webinar?.webinarName}. Please check your task list for details.`,
      type: notificationType.INFO,
      actionType: notificationActionType.ASSIGNMENT,
      metadata: {
        webinarId,
        attendeeId: newAttendee._id.toString(),
        assignmentId: newAssignment._id.toString(),
      },
    };

    await this.notificationService.createNotification(notification);

    return {
      success: true,
      message: 'Assignment created and attendee updated successfully.',
      data: { newAttendee, newAssignment },
    };
  }

  async getActiveInactiveAssignments(id: string): Promise<any> {
    const pipeline: PipelineStage[] = [
      {
        // Step 1: Match active assignments in the given date range (status: 'active')
        $match: {
          user: new Types.ObjectId(`${id}`),
          // status: 'active',
        },
      },
      {
        // Step 2: Lookup the Attendee details (by attendee field in assignments)
        $lookup: {
          from: 'attendees', // Collection name for Attendees
          localField: 'attendee', // Field in Assignments collection
          foreignField: '_id', // Field in Attendees collection
          as: 'attendeeDetails',
        },
      },
      {
        // Step 3: Unwind the attendeeDetails array to access attendee fields
        $unwind: {
          path: '$attendeeDetails',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        // Step 4: Lookup Notes collection to fetch call duration based on attendee email
        $lookup: {
          from: 'notes', // Collection name for Notes
          let: {
            attendeeEmail: '$attendeeDetails.email', // Pass attendee email
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$email', '$$attendeeEmail'] }, // Match email with attendee email
                    { $eq: ['$createdBy', new Types.ObjectId(id)] }, // Match createdBy with user ID
                  ],
                },
              },
            },
          ],
          as: 'notesDetails',
        },
      },
      {
        // Step 5: Unwind notesDetails array to access call duration
        $unwind: {
          path: '$notesDetails',
          preserveNullAndEmptyArrays: true, // Keep assignments even if no matching notes found
        },
      },
      {
        // Step 6: Add field to calculate call duration in seconds
        $addFields: {
          callDurationInSeconds: {
            $add: [
              {
                $multiply: [
                  {
                    $toInt: { $ifNull: ['$notesDetails.callDuration.hr', '0'] },
                  },
                  3600,
                ],
              },
              {
                $multiply: [
                  {
                    $toInt: {
                      $ifNull: ['$notesDetails.callDuration.min', '0'],
                    },
                  },
                  60,
                ],
              },
              { $toInt: { $ifNull: ['$notesDetails.callDuration.sec', '0'] } },
            ],
          },
        },
      },
      {
        // Step 7: Lookup to fetch minCallTime from the User collection based on the assigned user
        $lookup: {
          from: 'users', // Collection name for Users
          localField: 'user', // The user field in assignments
          foreignField: '_id',
          as: 'userDetails',
        },
      },
      {
        // Step 8: Unwind the userDetails to access the minCallTime
        $unwind: {
          path: '$userDetails',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        // Step 9: Add eligibility field to check if the call is eligible based on minCallTime
        $addFields: {
          isEligible: {
            $gte: [
              '$callDurationInSeconds',
              { $ifNull: ['$userDetails.validCallTime', 0] }, // Check against minCallTime from user
            ],
          },
        },
      },
      {
        // Step 10: Group by assignment ID and determine eligible/ineligible based on notes
        $group: {
          _id: '$attendee',
          email: { $first: '$attendeeDetails.email' },
          webinar: { $first: '$attendeeDetails.webinar' },
          assignmentId: { $first: '$_id' },
          isEligible: { $max: '$isEligible' }, // If any note is eligible, set isEligible as true
        },
      },
      {
        $lookup: {
          from: 'webinars',
          localField: 'webinar',
          foreignField: '_id',
          as: 'webinarDetails',
        },
      },
      {
        $unwind: {
          path: '$webinarDetails',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        // Step 11: Project the result with eligible and ineligible assignments
        $project: {
          assignmentId: 1,
          email: 1,
          isEligible: 1,
          webinar: '$webinarDetails.webinarName',
        },
      },
    ];

    const result = await this.assignmentsModel.aggregate(pipeline);
    return result;
  }

  async requestReAssignements(
    userId: string,
    adminId: string,
    assignments: string[],
    webinarId: string,
    requestReason: string,
    role: string,
    attendeeEmails: string[],
  ) {
    const recordType =
      this.configService.get('appRoles')['EMPLOYEE_REMINDER'] === role
        ? 'preWebinar'
        : 'postWebinar';

    const assignmentsIds = assignments.map(
      (assignment) => new Types.ObjectId(`${assignment}`),
    );
    const result = await this.assignmentsModel.updateMany(
      {
        adminId: new Types.ObjectId(`${adminId}`),
        user: new Types.ObjectId(`${userId}`),
        status: AssignmentStatus.ACTIVE,
        _id: { $in: assignmentsIds },
      },
      { $set: { status: AssignmentStatus.REASSIGN_REQUESTED, requestReason } },
    );

    const reassignmentCount = result.modifiedCount;

    const user = await this.userService.getUserById(userId);
    const userName = user?.userName || 'User';
    const webinar = await this.webinarService.getWebinarById(
      webinarId.toString(),
    );
    const webinarName = webinar?.webinarName || 'Webinar';

    if (reassignmentCount > 0) {
      const logs = attendeeEmails.map((email) => ({
        attendee: email,
        action: AttendeeAction.REASSIGNMENT_REQUEST,
        item: webinarName,
        details: `${userName} requested reassignment in webinar : ${webinarName}`,
        adminId: new Types.ObjectId(`${adminId}`),
      }));

      await this.attendeeLogService.createAttendeeLogs(logs);

      await this.notificationService.createNotification({
        recipient: adminId,
        title: `Reassignment Requests Submitted by ${userName}`,
        message: `${reassignmentCount} reassignment requests have been submitted from the webinar ${webinarName}.`,
        type: notificationType.INFO,
        actionType: notificationActionType.REASSIGNMENT,
        metadata: {
          userId,
          reassignmentCount,
          type: 'request',
          webinarId,
          recordType,
        },
      });
    }
    return result;
  }


  async cancelRequestReAssignements(
    userId: string,
    adminId: string,
    assignments: string[],
    webinarId: string,
    role: string,
    attendeeEmails: string[],
  ) {
    const recordType =
      this.configService.get('appRoles')['EMPLOYEE_REMINDER'] === role
        ? 'preWebinar'
        : 'postWebinar';

    const assignmentsIds = assignments.map(
      (assignment) => new Types.ObjectId(`${assignment}`),
    );
    const result = await this.assignmentsModel.updateMany(
      {
        adminId: new Types.ObjectId(`${adminId}`),
        user: new Types.ObjectId(`${userId}`),
        status: AssignmentStatus.REASSIGN_REQUESTED,
        _id: { $in: assignmentsIds },
      },
      { $set: { status: AssignmentStatus.ACTIVE, requestReason: null } },
    );

    const reassignmentCount = result.modifiedCount;

    const user = await this.userService.getUserById(userId);
    const userName = user?.userName || 'User';
    const webinar = await this.webinarService.getWebinarById(
      webinarId.toString(),
    );
    const webinarName = webinar?.webinarName || 'Webinar';

    if (reassignmentCount > 0) {
      const logs = attendeeEmails.map((email) => ({
        attendee: email,
        action: AttendeeAction.REASSIGNMENT_REQUEST,
        item: webinarName,
        details: `${userName} cancelled the request for reassignment in ${recordType === 'preWebinar' ? 'Reminder' : 'Sales'} webinar : ${webinarName}`,
        adminId: new Types.ObjectId(`${adminId}`),
      }));

      await this.attendeeLogService.createAttendeeLogs(logs);

      // await this.notificationService.createNotification({
      //   recipient: adminId,
      //   title: `Reassignment Requests Submitted by ${userName}`,
      //   message: `${reassignmentCount} reassignment requests have been submitted from the webinar ${webinarName}.`,
      //   type: notificationType.INFO,
      //   actionType: notificationActionType.REASSIGNMENT,
      //   metadata: {
      //     userId,
      //     reassignmentCount,
      //     type: 'request',
      //     webinarId,
      //     recordType,
      //   },
      // });
    }
    return result;
  }

  async getPullbackRequestsCount(
    recordType: string,
    adminId: Types.ObjectId,
    webinar: Types.ObjectId,
  ) {
    const pipeline: PipelineStage[] = [
      {
        $match: {
          adminId,
          recordType,
          webinar,
        },
      },
      {
        $facet: {
          requests: [
            { $match: { status: 'reassignrequested' } },
            { $group: { _id: null, count: { $sum: 1 } } },
          ],
          pullbacks: [
            { $match: { status: 'reassignapproved' } },
            { $group: { _id: null, count: { $sum: 1 } } },
          ],
        },
      },
      {
        $project: {
          requests: { $arrayElemAt: ['$requests.count', 0] },
          pullbacks: { $arrayElemAt: ['$pullbacks.count', 0] },
        },
      },
    ];

    const result = await this.assignmentsModel.aggregate(pipeline);
    return Array.isArray(result) && result.length > 0
      ? result[0]
      : { requests: 0, pullbacks: 0 };
  }

  async getReAssignments(
    adminId: string,
    webinarId: string,
    recordType: RecordType,
    status: AssignmentStatus,
    page: number,
    limit: number,
  ) {
    const skip = (page - 1) * limit;
    const pipeline: PipelineStage[] = [
      {
        $match: {
          adminId: new Types.ObjectId(`${adminId}`),
          recordType: recordType,
          status: status,
          webinar: new Types.ObjectId(`${webinarId}`),
        },
      },
      {
        $sort: {
          updatedAt: -1,
        },
      },
      {
        $lookup: {
          from: 'attendees',
          localField: 'attendee',
          foreignField: '_id',
          as: 'attendeeDetails',
        },
      },
      {
        $unwind: {
          path: '$attendeeDetails',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'user',
          foreignField: '_id',
          as: 'userDetails',
        },
      },
      {
        $unwind: {
          path: '$userDetails',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $addFields: {
          attendeeEmail: '$attendeeDetails.email',
          assignedTo: '$userDetails.userName',
        },
      },
      {
        $project: {
          attendeeDetails: 0,
          userDetails: 0,
          createdAt: 0,
          updatedAt: 0,
        },
      },
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [{ $skip: skip }, { $limit: limit }],
        },
      },
      {
        $unwind: {
          path: '$metadata',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          totalPages: { $ceil: { $divide: ['$metadata.total', limit] } },
          page: { $literal: page },
          result: '$data',
        },
      },
    ];

    const result = await this.assignmentsModel.aggregate(pipeline);
    return Array.isArray(result) && result.length > 0
      ? result[0]
      : { result: [], page, totalPages: 0 };
  }

  async approveReAssignments(
    adminId: string,
    assignments: string[],
    status: string,
    userId: string,
    webinarId: string,
    attendeeEmails: string[],
  ) {
    const assignmentsIds = assignments.map(
      (assignment) => new Types.ObjectId(`${assignment}`),
    );

    if (status === 'approved') {
      const session = await this.assignmentsModel.db.startSession();
      session.startTransaction();

      try {
        const updatedAssignmentsResult = await this.assignmentsModel.updateMany(
          {
            adminId: new Types.ObjectId(`${adminId}`),
            _id: { $in: assignmentsIds },
          },
          { $set: { status: AssignmentStatus.REASSIGN_APPROVED } },
          { session },
        );

        if (updatedAssignmentsResult.matchedCount !== assignmentsIds.length) {
          throw new NotFoundException('Some assignments were not found');
        }

        const updatedAssignments = await this.assignmentsModel
          .find(
            {
              adminId: new Types.ObjectId(`${adminId}`),
              _id: { $in: assignmentsIds },
            },
            { attendee: 1 },
          )
          .session(session);

        const attendeeIds = updatedAssignments.map(
          (assignment) => assignment.attendee,
        );

        const updatedAttendeesResult =
          await this.attendeeService.updateAttendees(
            {
              _id: { $in: attendeeIds },
              adminId: new Types.ObjectId(`${adminId}`),
            },
            { isPulledback: true },
            session,
          );

        if (updatedAttendeesResult.matchedCount !== attendeeIds.length) {
          throw new NotFoundException('Some attendees were not found');
        }

        await session.commitTransaction();
        session.endSession();

        const webinar = await this.webinarService.getWebinarById(
          webinarId.toString(),
        );
        const webinarName = webinar?.webinarName || 'Webinar';

        await this.notificationService.createNotification({
          recipient: userId,
          title: 'Reassignment Request Approved',
          message: `Your reassignment request has been approved from the webinar ${webinarName}.`,
          type: notificationType.SUCCESS,
          actionType: notificationActionType.REASSIGNMENT,
          metadata: {
            type: 'request',
            webinarId: webinarId,
          },
        });

        if (attendeeEmails?.length) {
          const logs = attendeeEmails.map((email) => ({
            attendee: email,
            action: AttendeeAction.REASSIGNMENT_APPROVED,
            item: webinarName,
            details: `Reassignment request approved in webinar : ${webinarName}`,
            adminId: new Types.ObjectId(`${adminId}`),
          }));

          await this.attendeeLogService.createAttendeeLogs(logs);
        }

        return {
          updatedAssignments: updatedAssignmentsResult,
          updatedAttendees: updatedAttendeesResult,
        };
      } catch (error) {
        await session.abortTransaction();
        session.endSession();
        throw error;
      }
    } else if (status === 'rejected') {
      const result = await this.assignmentsModel.updateMany(
        {
          adminId: new Types.ObjectId(`${adminId}`),
          _id: { $in: assignmentsIds },
        },
        { $set: { status: AssignmentStatus.ACTIVE } },
      );

      const webinar = await this.webinarService.getWebinarById(
        webinarId.toString(),
      );
      const webinarName = webinar?.webinarName || 'Webinar';

      await this.notificationService.createNotification({
        recipient: userId,
        title: 'Reassignment Request Rejected',
        message: `Your reassignment request has been rejected from the webinar ${webinarName}.`,
        type: notificationType.WARNING,
        actionType: notificationActionType.REASSIGNMENT,
        metadata: {
          type: 'request',
          webinarId: webinarId,
        },
      });

      if (attendeeEmails?.length) {
        const logs = attendeeEmails.map((email) => ({
          attendee: email,
          action: AttendeeAction.REASSIGNMENT_REJECTED,
          item: webinarName,
          details: `Reassignment request Rejected in webinar : ${webinarName}`,
          adminId: new Types.ObjectId(`${adminId}`),
        }));

        await this.attendeeLogService.createAttendeeLogs(logs);
      }

      return result;
    } else {
      throw new BadRequestException('Invalid status provided.');
    }
  }

  async changeAssignment(data: ReAssignmentDTO, adminId: string) {
    console.log(data);
    const session = await this.assignmentsModel.startSession();
    try {
      let updatedAssignmentsCount = 0;
      let updatedAttendeesCount = 0;
      let newAssignments: any = null;
      await session.withTransaction(async (currentSession) => {
        const employee = await this.userService.getEmployee(data.employeeId);
        if (!employee || employee.adminId.toString() !== `${adminId}`) {
          throw new NotFoundException(
            'Employee not found or unauthorized access',
          );
        }
        if (!employee.isActive) {
          throw new BadRequestException('Employee is inactive');
        }
        if (
          employee.dailyContactCount >= employee.dailyContactLimit &&
          !data.forceAssign
        ) {
          throw new BadRequestException(
            'Employee has reached daily contact limit',
          );
        }

        const assignmentIds = data.assignments.map(
          (a) => new Types.ObjectId(a.assignmentId),
        );
        const attendeeIds = data.assignments.map(
          (a) => new Types.ObjectId(a.attendeeId),
        );

        const deletedAssignmentsResult = await this.assignmentsModel.deleteMany(
          {
            _id: { $in: assignmentIds },
            adminId: new Types.ObjectId(`${adminId}`),
            webinar: new Types.ObjectId(data.webinarId),
            attendee: { $in: attendeeIds },
            recordType: data.recordType,
          },
          { session: currentSession },
        );

        if (deletedAssignmentsResult.deletedCount !== data.assignments.length) {
          throw new NotFoundException(
            'Some assignments were not found or unauthorized access',
          );
        }

        const query = data.isTemp
          ? { tempAssignedTo: employee._id }
          : { assignedTo: employee._id, tempAssignedTo: null };

        const updatedAttendeesResult =
          await this.attendeeService.updateAttendees(
            {
              _id: { $in: attendeeIds },
              adminId: new Types.ObjectId(`${adminId}`),
              webinar: new Types.ObjectId(data.webinarId),
              isAttended:
                data.recordType === RecordType.POST_WEBINAR ? true : false,
            },
            { isPulledback: false, ...query, status: null },
            currentSession,
          );

        if (updatedAttendeesResult.matchedCount !== data.assignments.length) {
          throw new NotFoundException(
            'Some attendees were not found or unauthorized access',
          );
        }

        const newAssignmentsData = data.assignments.map((assignment) => ({
          adminId: new Types.ObjectId(`${adminId}`),
          user: employee._id,
          webinar: new Types.ObjectId(data.webinarId),
          attendee: new Types.ObjectId(assignment.attendeeId),
          recordType: data.recordType,
          status: AssignmentStatus.ACTIVE,
          ...(data.isTemp ? { isTemporary: true } : {}),
        }));

        const createdAssignments = await this.assignmentsModel.insertMany(
          newAssignmentsData,
          { session: currentSession },
        );

        if (
          !createdAssignments ||
          createdAssignments.length !== data.assignments.length
        ) {
          throw new InternalServerErrorException(
            'Failed to create all new assignments',
          );
        }

        await this.userService.incrementCount(
          employee._id.toString(),
          createdAssignments.length,
          currentSession,
        );

        const webinar = await this.webinarService.getWebinarById(
          data.webinarId.toString(),
        );
        const webinarName = webinar?.webinarName || 'Webinar';

        const attendees = await this.attendeeService.getAttendeesByIds(
          new Types.ObjectId(`${adminId}`),
          newAssignmentsData.map((a) => a.attendee),
        );

        // Send notification
        if (createdAssignments?.length) {
          if (attendees?.length) {
            const logs = attendees.map((attendee) => ({
              attendee: attendee.email,
              action: AttendeeAction.REASSIGNMENT,
              item: webinarName,
              details: ` Attendee Reassigned to ${employee.userName} ${data.isTemp ? 'temporarily' : ''} in webinar : ${webinarName}`,
              adminId: new Types.ObjectId(`${adminId}`),
            }));

            await this.attendeeLogService.createAttendeeLogs(
              logs,
              currentSession,
            );
          }

          await this.notificationService.createNotification({
            recipient: employee._id.toString(),
            title: 'New Tasks Assigned',
            message: `You have been assigned ${createdAssignments.length} new tasks ${data.isTemp ? 'temporarily' : ''} in the webinar ${webinarName} . Please check your task list for details.`,
            type: notificationType.INFO,
            actionType: notificationActionType.REASSIGNMENT,
            metadata: {
              webinarId: data.webinarId,
            },
          });
        }

        updatedAssignmentsCount = deletedAssignmentsResult.deletedCount;
        updatedAttendeesCount = updatedAttendeesResult.matchedCount;
        newAssignments = createdAssignments;
      });
      await this.getEmployeeDailyContactCount(new Types.ObjectId(`${adminId}`));
      return {
        message: 'Reassignment completed successfully',
        updatedAssignmentsCount,
        updatedAttendeesCount,
        newAssignments,
      };
    } catch (error) {
      console.error('Transaction failed during hideAttendees:', error);
      throw new BadRequestException(error.message);
    } finally {
      await session.endSession();
      console.log('Session ended.');
    }
  }

  async changeAttendeeAssignmentStatus(
    data: MoveToPullbacksDTO,
    adminId: string,
  ) {
    const {
      employeeId,
      webinarId,
      recordType,
      isTemp,
      attendees,
      forceAssign,
    } = data;
    const attendeeIds = attendees.map(
      (attendee) => new Types.ObjectId(`${attendee}`),
    );

    if (!employeeId) {
      try {
        const updatedAttendeesResult =
          await this.attendeeService.updateAttendees(
            {
              adminId: new Types.ObjectId(adminId),
              webinar: new Types.ObjectId(webinarId),
              isAttended: recordType === RecordType.POST_WEBINAR,
              assignedTo: { $ne: null },
              _id: { $in: attendeeIds },
            },
            { isPulledback: true },
          );

        if (updatedAttendeesResult.matchedCount !== attendeeIds.length) {
          throw new NotFoundException(
            'Some attendees were not found or unauthorized access',
          );
        }

        const updatedAssignmentsResult = await this.assignmentsModel.updateMany(
          {
            attendee: { $in: attendeeIds },
            adminId: new Types.ObjectId(adminId),
            webinar: new Types.ObjectId(webinarId),
            recordType: recordType,
          },
          { $set: { status: AssignmentStatus.REASSIGN_APPROVED } },
        );

        if (updatedAssignmentsResult.matchedCount !== attendeeIds.length) {
          await this.attendeeService.updateAttendees(
            { _id: { $in: attendeeIds } },
            { isPulledback: false },
          );
          throw new NotFoundException(
            'Some assignments were not found for the attendees',
          );
        }

        await this.getEmployeeDailyContactCount(
          new Types.ObjectId(`${adminId}`),
        );



        const attendees = await this.attendeeService.getAttendeesByIds(
          new Types.ObjectId(`${adminId}`),
          attendeeIds);

        if (attendees?.length) {
          const webinar = await this.webinarService.getWebinarById(webinarId);
          const webinarName = webinar?.webinarName || 'Webinar';

          const logs = attendees.map((attendee) => ({
            attendee: attendee.email,
            action: AttendeeAction.PULLBACK,
            item: webinarName,
            details: ` Attendee has been Pulled back in webinar : ${webinarName}`,
            adminId: new Types.ObjectId(`${adminId}`),
          }));

          await this.attendeeLogService.createAttendeeLogs(
            logs
          );
        }

        return {
          message: 'Attendees and assignments updated successfully',
          updatedAttendeesCount: updatedAttendeesResult.modifiedCount,
          updatedAssignmentsCount: updatedAssignmentsResult.modifiedCount,
        };
      } catch (error) {
        throw error;
      }
    } else {
      const assignments = await this.assignmentsModel.find({
        adminId: new Types.ObjectId(adminId),
        webinar: new Types.ObjectId(webinarId),
        recordType: recordType,
        attendee: { $in: attendeeIds },
      });

      if (!assignments || assignments.length === 0) {
        throw new NotFoundException(
          `No assignments found for the given webinar and adminId: ${webinarId} ${adminId}`,
        );
      }

      return await this.changeAssignment(
        {
          assignments: assignments.map((assignment) => ({
            attendeeId: assignment.attendee.toString(),
            assignmentId: assignment._id.toString(),
          })),
          employeeId,
          webinarId,
          recordType,
          isTemp,
          forceAssign,
        },
        adminId,
      );
    }
  }

  async createManyAssignments(assignments: any, session: ClientSession) {
    return this.assignmentsModel.insertMany(assignments, { session });
  }

  async fetchTotalAssignmentsForNotes(
    employeeId: string,
    startDate: string,
    endDate: string,
  ) {
    return this.assignmentsModel.aggregate([
      {
        $match: {
          user: new Types.ObjectId(`${employeeId}`),
          createdAt: {
            $gte: new Date(startDate),
            $lte: new Date(endDate),
          },
        },
      },
      {
        $group: {
          _id: null,
          uniqueValues: {
            $addToSet: '$attendee',
          },
        },
      },
      {
        $project: {
          totalAssignments: { $size: '$uniqueValues' },
        },
      },
    ]);
  }

  async fetchAssignmentsForNotes(
    employeeId: Types.ObjectId,
    startDate: Date,
    endDate: Date,
  ) {
    return this.assignmentsModel.aggregate([
      {
        $match: {
          user: employeeId,
          createdAt: {
            $gte: startDate,
            $lte: endDate,
          },
        },
      },
      {
        $group: {
          _id: null,
          uniqueValues: {
            $addToSet: '$attendee',
          },
        },
      },
      {
        $project: {
          totalAssignments: { $size: '$uniqueValues' },
        },
      },
    ]);
  }

  // Make sure your assignmentsModel is properly injected/available (`this.assignmentsModel`)

  async findAssignmentsForTodayIST_NoLib(metaData: {
    adminId: Types.ObjectId;
    webinarId?: Types.ObjectId;
    attendeeIds?: Types.ObjectId[];
  }) {
    // 1. Define IST Offset in milliseconds (UTC+5:30)
    const IST_OFFSET_HOURS = 5;
    const IST_OFFSET_MINUTES = 30;
    const istOffsetMilliseconds =
      (IST_OFFSET_HOURS * 60 + IST_OFFSET_MINUTES) * 60 * 1000;

    // 2. Get current time in UTC milliseconds
    const nowUtcMs = Date.now(); // Equivalent to new Date().getTime()

    // 3. Calculate the equivalent millisecond timestamp representing the current moment *in* IST
    const nowInISTEquivalentMs = nowUtcMs + istOffsetMilliseconds;

    // 4. Create a temporary Date object based on the IST-equivalent time.
    //    We will use UTC methods on this object to extract the Y/M/D components *as they appear in IST*.
    const tempISTDate = new Date(nowInISTEquivalentMs);

    const yearIST = tempISTDate.getUTCFullYear();
    const monthIST = tempISTDate.getUTCMonth(); // 0-indexed (January is 0)
    const dayIST = tempISTDate.getUTCDate();

    // 5. Calculate the UTC timestamp corresponding to the *start* of "today" in IST (00:00:00 IST).
    //    This is done by finding 00:00:00 UTC on the derived IST date components,
    //    and then subtracting the IST offset.
    const midnightUTCForISTDateMs = Date.UTC(
      yearIST,
      monthIST,
      dayIST,
      0,
      0,
      0,
      0,
    );
    const startOfISTDayInUTCms =
      midnightUTCForISTDateMs - istOffsetMilliseconds;
    const startOfTodayUTC = new Date(startOfISTDayInUTCms);

    // 6. Calculate the UTC timestamp corresponding to the *start* of the *next day* in IST (00:00:00 IST tomorrow).
    //    This will be the exclusive upper bound for the query.
    //    Use Date.UTC to handle potential month/year rollovers automatically when adding 1 day.
    const midnightUTCForNextISTDateMs = Date.UTC(
      yearIST,
      monthIST,
      dayIST + 1,
      0,
      0,
      0,
      0,
    );
    const startOfNextISTDayInUTCms =
      midnightUTCForNextISTDateMs - istOffsetMilliseconds;
    const startOfTomorrowUTC = new Date(startOfNextISTDayInUTCms);

    // --- Logging for verification (optional) ---
    const formatDateUTC = (d) => d.toISOString(); // Simple UTC ISO string
    console.log(
      `Current Time (System UTC): ${new Date(nowUtcMs).toISOString()}`,
    );
    console.log(
      `Start of Today (IST) in UTC: ${formatDateUTC(startOfTodayUTC)}`,
    );
    console.log(
      `Start of Tomorrow (IST) in UTC: ${formatDateUTC(startOfTomorrowUTC)}`,
    );
    console.log('--- Querying MongoDB using UTC boundaries (No Library) ---');
    // --- End Logging ---

    // 7. Construct the Mongoose Query
    const queryConditions = {
      adminId: metaData.adminId,
      createdAt: {
        $gte: startOfTodayUTC, // Greater than or equal to the start of today (IST) in UTC
        $lt: startOfTomorrowUTC, // Less than the start of tomorrow (IST) in UTC
      },

      ...(metaData.webinarId ? { webinar: metaData.webinarId } : {}),
      ...(metaData.attendeeIds &&
        metaData.attendeeIds.length > 0 && {
        attendee: { $in: metaData.attendeeIds },
      }),
    };

    const pipeline: PipelineStage[] = [
      {
        $match: queryConditions,
      },
      {
        $group: {
          _id: '$user',
          count: { $sum: 1 },
        },
      },
    ];

    const assignments = await this.assignmentsModel.aggregate(pipeline);
    console.log(
      `Found ${assignments.length} assignments created today (IST) without external library.`,
    );

    await this.userService.updateEmployeeAssignmentCounts(assignments);

    return assignments;
  }

  async deleteAssignmentsByWebinar(
    session: ClientSession,
    adminId: Types.ObjectId,
    webinarId: Types.ObjectId,
    attendeeIds?: Types.ObjectId[],
  ) {
    const assignments = await this.findAssignmentsForTodayIST_NoLib({
      adminId,
      webinarId,
      attendeeIds,
    });

    return this.assignmentsModel
      .deleteMany(
        {
          adminId: adminId,
          webinar: webinarId,
          ...(attendeeIds && { attendee: { $in: attendeeIds } }),
        },
        { session },
      )
      .exec();
  }

  async deleteAssignmentsByAttendeeIds(
    session: ClientSession,
    adminId: Types.ObjectId,
    attendeeIds: Types.ObjectId[],
  ) {
    const assignments = await this.findAssignmentsForTodayIST_NoLib({
      adminId,
      attendeeIds,
    });
    return this.assignmentsModel
      .deleteMany(
        {
          adminId: adminId,
          attendee: { $in: attendeeIds },
        },
        { session },
      )
      .exec();
  }

  validateDate(start: string, end: string): { startDate: Date; endDate: Date } {
    const startDate = new Date(start);
    const endDate = new Date(end);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new BadRequestException('Invalid date format');
    }

    if (startDate > endDate) {
      throw new BadRequestException(
        'Start date cannot be greater than end date',
      );
    }
    return { startDate, endDate };
  }

  getPipelineStage(startDate: Date, endDate: Date): PipelineStage[] {
    return [
      {
        $match: {
          $expr: {
            $and: [
              {
                $gte: [
                  {
                    $dateFromParts: {
                      year: {
                        $year: { date: '$createdAt', timezone: 'Asia/Kolkata' },
                      },
                      month: {
                        $month: {
                          date: '$createdAt',
                          timezone: 'Asia/Kolkata',
                        },
                      },
                      day: {
                        $dayOfMonth: {
                          date: '$createdAt',
                          timezone: 'Asia/Kolkata',
                        },
                      },
                      timezone: 'Asia/Kolkata',
                    },
                  },
                  startDate,
                ],
              },
              {
                $lte: [
                  {
                    $dateFromParts: {
                      year: {
                        $year: { date: '$createdAt', timezone: 'Asia/Kolkata' },
                      },
                      month: {
                        $month: {
                          date: '$createdAt',
                          timezone: 'Asia/Kolkata',
                        },
                      },
                      day: {
                        $dayOfMonth: {
                          date: '$createdAt',
                          timezone: 'Asia/Kolkata',
                        },
                      },
                      timezone: 'Asia/Kolkata',
                    },
                  },
                  endDate,
                ],
              },
            ],
          },
        },
      },
    ];
  }

  async getDailyAssignmentStats(
    user: string,
    admin: string,
    startDate: Date,
    endDate: Date,
    webinarId?: string,
  ) {
    const userId = new Types.ObjectId(`${user}`);
    const adminId = new Types.ObjectId(`${admin}`);

    const result = await this.assignmentsModel.aggregate([
      {
        $match: {
          adminId,
          ...(webinarId ? { webinar: new Types.ObjectId(webinarId) } : {}),
          user: userId,
        },
      },
      ...this.getPipelineStage(startDate, endDate),
      {
        $lookup: {
          from: 'attendees',
          localField: 'attendee',
          foreignField: '_id',
          as: 'attendeeDetails',
        },
      },
      {
        $unwind: {
          path: '$attendeeDetails',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$createdAt',
              timezone: '+05:30',
            },
          },
          count: { $sum: 1 },
          completed: {
            $sum: {
              $cond: [{ $ne: ['$attendeeDetails.status', null] }, 1, 0],
            },
          },
        },
      },
      {
        $sort: { _id: 1 },
      },
      {
        $project: {
          date: '$_id',
          count: 1,
          completed: 1,
          _id: 0,
        },
      },
    ]);

    return {
      success: true,
      data: result,
      message: 'Daily assignment stats fetched successfully',
    };
  }

  async getAllAssignmentsByDateRange(
    adminId: string,
    startDate: Date,
    endDate: Date,
    webinarId?: string,
  ) {
    const pipeline: PipelineStage[] = [
      {
        $match: {
          adminId: new Types.ObjectId(adminId),
          ...(webinarId ? { webinar: new Types.ObjectId(webinarId) } : {}),
        },
      },
      ...this.getPipelineStage(startDate, endDate),
      {
        $lookup: {
          from: 'attendees',
          localField: 'attendee',
          foreignField: '_id',
          as: 'attendeeDetails',
        },
      },
      {
        $unwind: {
          path: '$attendeeDetails',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $group: {
          _id: {
            date: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$createdAt',
                timezone: '+05:30',
              },
            },
            user: '$user',
          },
          count: { $sum: 1 },
          completed: {
            $sum: {
              $cond: [{ $ne: ['$attendeeDetails.status', null] }, 1, 0],
            },
          },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id.user',
          foreignField: '_id',
          as: 'userDetails',
        },
      },
      {
        $project: {
          count: 1,
          completed: 1,
          date: '$_id.date',
          userName: {
            $arrayElemAt: ['$userDetails.userName', 0],
          },
        },
      },
      {
        $sort: { _id: 1 },
      },
    ];

    const result = await this.assignmentsModel.aggregate(pipeline);
    return {
      success: true,
      data: result,
      message: 'Assignments fetched successfully',
    };
  }

  async getAssignmentsCount(
    startDate: Date,
    endDate: Date,
    adminId: Types.ObjectId,
    webinar?: Types.ObjectId,
  ) {
    const pipeline = [
      {
        $match: {
          adminId,
          ...(webinar ? { webinar } : {}), // Optional filter for webinarId
          $expr: {
            $and: [
              {
                $gte: [
                  {
                    $dateFromParts: {
                      year: {
                        $year: {
                          date: '$createdAt',
                          timezone: 'Asia/Kolkata',
                        },
                      },
                      month: {
                        $month: {
                          date: '$createdAt',
                          timezone: 'Asia/Kolkata',
                        },
                      },
                      day: {
                        $dayOfMonth: {
                          date: '$createdAt',
                          timezone: 'Asia/Kolkata',
                        },
                      },
                      timezone: 'Asia/Kolkata',
                    },
                  },
                  startDate,
                ],
              },
              {
                $lte: [
                  {
                    $dateFromParts: {
                      year: {
                        $year: {
                          date: '$createdAt',
                          timezone: 'Asia/Kolkata',
                        },
                      },
                      month: {
                        $month: {
                          date: '$createdAt',
                          timezone: 'Asia/Kolkata',
                        },
                      },
                      day: {
                        $dayOfMonth: {
                          date: '$createdAt',
                          timezone: 'Asia/Kolkata',
                        },
                      },
                      timezone: 'Asia/Kolkata',
                    },
                  },
                  endDate,
                ],
              },
            ],
          },
        },
      },
      {
        $group: {
          _id: '$user',
          count: {
            $sum: 1,
          },
          attendees: {
            $push: '$attendee',
          },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'userData',
        },
      },
      {
        $project: {
          count: 1,
          attendees: 1,
          validCallTime: {
            $arrayElemAt: ['$userData.validCallTime', 0],
          },
          userEmail: {
            $arrayElemAt: ['$userData.email', 0],
          },
        },
      },
    ];

    return this.assignmentsModel
      .aggregate(pipeline, { allowDiskUse: true })
      .exec();
  }

  async getAssignmentByAttendeeId(attendee: Types.ObjectId) {
    return this.assignmentsModel.findOne({ attendee }).exec();
  }

  async getEmployeeAssignments(
    startDate: Date,
    endDate: Date,
    user: Types.ObjectId,
    webinar?: Types.ObjectId,
  ) {
    return this.assignmentsModel
      .find({
        user,
        ...(webinar ? { webinar } : {}),
        status: AssignmentStatus.ACTIVE,
        $expr: {
          $and: [
            {
              $gte: [
                {
                  $dateFromParts: {
                    year: {
                      $year: {
                        date: '$createdAt',
                        timezone: 'Asia/Kolkata',
                      },
                    },
                    month: {
                      $month: {
                        date: '$createdAt',
                        timezone: 'Asia/Kolkata',
                      },
                    },
                    day: {
                      $dayOfMonth: {
                        date: '$createdAt',
                        timezone: 'Asia/Kolkata',
                      },
                    },
                    timezone: 'Asia/Kolkata',
                  },
                },
                startDate,
              ],
            },
            {
              $lte: [
                {
                  $dateFromParts: {
                    year: {
                      $year: {
                        date: '$createdAt',
                        timezone: 'Asia/Kolkata',
                      },
                    },
                    month: {
                      $month: {
                        date: '$createdAt',
                        timezone: 'Asia/Kolkata',
                      },
                    },
                    day: {
                      $dayOfMonth: {
                        date: '$createdAt',
                        timezone: 'Asia/Kolkata',
                      },
                    },
                    timezone: 'Asia/Kolkata',
                  },
                },
                endDate,
              ],
            },
          ],
        },
      })
      .select('attendee')
      .exec();
  }

  async getEmployeeDailyContactCount(
    adminId: Types.ObjectId,
    session?: ClientSession,
  ) {
    console.log('Getting employee daily contact count...');
    // 1. Get the current date/time in UTC.
    // MongoDB stores dates in UTC by default, and Date objects in JS are also time zone aware
    // but manipulations often involve UTC or local time depending on the method.
    const now = new Date();

    // 2. Calculate the start and end boundaries for "today" in IST (UTC+5:30).
    // IST is UTC + 5 hours 30 minutes.
    // This means midnight in IST is 18:30 UTC the *previous* day.
    // So, "today" in IST spans from 18:30 UTC yesterday to 18:30 UTC today.

    // Calculate the UTC Date object for TODAY at 18:30 UTC.
    // This point marks the END boundary (exclusive) of the IST day we're interested in.
    const endOfISTDay = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        18, // UTC Hour (18 for 18:30)
        30, // UTC Minute (30 for 18:30)
        0, // UTC Second
        0, // UTC Millisecond
      ),
    );

    // Calculate the UTC Date object for YESTERDAY at 18:30 UTC.
    // This point marks the START boundary (inclusive) of the IST day we're interested in.
    const startOfISTDay = new Date(endOfISTDay.getTime() - 24 * 60 * 60 * 1000); // Subtract 24 hours

    // 3. Define the query filter.
    // We want documents where:
    // - user matches the given empId
    // - createdAt is greater than or equal to the start of the IST day (in UTC)
    // - createdAt is strictly less than the end of the IST day (in UTC)
    const filter = {
      adminId,
      status: AssignmentStatus.ACTIVE,
      createdAt: {
        $gte: startOfISTDay, // Greater than or equal to the start of the IST day
        $lt: endOfISTDay, // Less than the end of the IST day
      },
    };
    const pipeline: PipelineStage[] = [
      {
        $match: filter,
      },
      {
        $group: {
          _id: '$user',
          totalAssignments: {
            $sum: 1,
          },
        },
      },
    ];

    const result = await this.assignmentsModel.aggregate(pipeline).exec();

    console.log(result);

    return await this.userService.updateDailyContactCount(
      result,
      adminId,
      session,
    );
  }
}
