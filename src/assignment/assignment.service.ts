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
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, PipelineStage, Types } from 'mongoose';
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
  PreWebinarPostAttendeeDTO,
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
import { EnrollmentsService } from 'src/enrollments/enrollments.service';
import { AttendeeLogService } from 'src/attendee-log/attendee-log.service';
import { AttendeeAction } from 'src/schemas/attendee-logs.schema';
import { User } from 'src/schemas/User.schema';
import { Webinar } from 'src/schemas/Webinar.schema';
import mongoose from 'mongoose';
import { WebinarAutoMessageService } from 'src/webinar-auto-message/webinar-auto-message.service';

@Injectable()
export class AssignmentService {
  constructor(
    @InjectModel(Assignments.name) private assignmentsModel: Model<Assignments>,

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
    private readonly enrollmentService: EnrollmentsService,
    private readonly attendeeLogService: AttendeeLogService,
    private readonly autoMessageService: WebinarAutoMessageService,
  ) {}

  async getAssignments(
    adminId: string,
    id: string,
    page: number,
    limit: number,
    filters: AttendeesFilterDto = {},
    obj: {
      webinarId: string;
      validCall?: string;
      assignmentStatus?: AssignmentStatus;
      sort?: WebinarAttendeesSortObject;
      validCallFlag?: string;
      formatLeadType?: boolean;
    },
  ): Promise<any> {
    const {
      webinarId = '',
      validCall = '',
      assignmentStatus,
      formatLeadType,
      sort = {
        sortBy: WebinarAttendeesSortBy.EMAIL,
        sortOrder: SortOrder.ASC,
      },
      validCallFlag = 'all',
    } = obj;

    let validCallTime = 0;
    if (validCallFlag !== 'all' && validCall === 'Worked') {
      const emp = await this.userService.getUserById(id);
      if (!emp) {
        throw new NotFoundException('Employee not found');
      }
      if (emp.validCallTime) {
        validCallTime = emp.validCallTime;
      }
    }

    let notesMatchCondition;

    if (validCallFlag === 'valid') {
      notesMatchCondition = {
        $elemMatch: {
          callDuration: { $gte: validCallTime },
        },
      };
    } else {
      // If validCallFlag is not 'valid', we want *every* callDuration to be < validCallTime.
      // This means there should be *no* note where callDuration is >= validCallTime.
      notesMatchCondition = {
        $not: {
          // Negate the condition that follows
          $elemMatch: {
            // Check if there's any element that violates the rule
            callDuration: { $gte: validCallTime }, // A note with callDuration >= validCallTime would violate "every is smaller"
          },
        },
      };
    }

    const attendanceCountStages: PipelineStage[] = [
      {
        $lookup: {
          from: 'attendees',
          let: { attendeeEmail: '$email' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$email', '$$attendeeEmail'] },
                    { $eq: ['$adminId', new Types.ObjectId(adminId)] },
                    { $ne: ['$isDeleted', true] },
                  ],
                },
              },
            },
            {
              $group: {
                _id: null,
                registeredCount: {
                  $sum: { $cond: { if: '$isAttended', then: 0, else: 1 } },
                },
                attendedCount: {
                  $sum: {
                    $cond: {
                      if: {
                        $and: [
                          { $eq: ['$isAttended', true] }, // Condition 1: isAttended must be true
                          { $gt: ['$timeInSession', 0] }, // Condition 2: timeInSession must be greater than 0
                        ],
                      },
                      then: 1,
                      else: 0,
                    },
                  },
                },
              },
            },
          ],
          as: 'attendanceHistory',
        },
      },
      {
        $unwind: {
          path: '$attendanceHistory',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $addFields: {
          registeredCount: {
            $ifNull: ['$attendanceHistory.registeredCount', 0],
          },
          attendedCount: { $ifNull: ['$attendanceHistory.attendedCount', 0] },
        },
      },
    ];

    const attendanceCountFilter = {};
    if (filters.registeredCount) {
      attendanceCountFilter['registeredCount'] = {};
      if (filters.registeredCount.$gte !== undefined) {
        attendanceCountFilter['registeredCount']['$gte'] = parseInt(
          `${filters.registeredCount.$gte}`,
          10,
        );
      }
      if (filters.registeredCount.$lte !== undefined) {
        attendanceCountFilter['registeredCount']['$lte'] = parseInt(
          `${filters.registeredCount.$lte}`,
          10,
        );
      }
    }
    if (filters.attendedCount) {
      attendanceCountFilter['attendedCount'] = {};
      if (filters.attendedCount.$gte !== undefined) {
        attendanceCountFilter['attendedCount']['$gte'] = parseInt(
          `${filters.attendedCount.$gte}`,
          10,
        );
      }
      if (filters.attendedCount.$lte !== undefined) {
        attendanceCountFilter['attendedCount']['$lte'] = parseInt(
          `${filters.attendedCount.$lte}`,
          10,
        );
      }
    }

    const skip = (page - 1) * limit;
    const basePipeline: PipelineStage[] = [
      {
        $match: {
          adminId: new Types.ObjectId(adminId),
          ...(id && { user: new Types.ObjectId(id) }),
          ...(mongoose.isValidObjectId(webinarId) && {
            webinar: new Types.ObjectId(webinarId),
          }),
          status: assignmentStatus,
          ...(filters.createdAt && {
            createdAt: {
              ...(filters.createdAt.$gte && {
                $gte: new Date(filters.createdAt.$gte),
              }),
              ...(filters.createdAt.$lte && {
                $lte: new Date(filters.createdAt.$lte),
              }),
            },
          }),
        },
      },
      ...(validCallFlag !== 'all' &&
      validCall === 'Worked' &&
      mongoose.isValidObjectId(id)
        ? [
            {
              $lookup: {
                from: 'notes',
                let: {
                  tempAttendee: '$attendee',
                  tempUser: new Types.ObjectId(`${id}`),
                },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          {
                            $eq: ['$attendee', '$$tempAttendee'],
                          },
                          {
                            $eq: ['$createdBy', '$$tempUser'],
                          },
                        ],
                      },
                    },
                  },
                  {
                    $project: {
                      callDuration: 1,
                    },
                  },
                ],
                as: 'notes',
              },
            },
            {
              $match: {
                notes: notesMatchCondition,
              },
            },
          ]
        : []),

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
            gender: filters.gender.trim().toLocaleLowerCase(),
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
            status: { $in: filters.status },
          }),
          ...(filters.tags && {
            tags: { $in: filters.tags },
          }),
          ...(filters.source && {
            source: { $regex: filters.source, $options: 'i' },
          }),
        },
      },
      ...(Array.isArray(filters.leadType) && filters.leadType.length > 0
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
                            $in: [
                              '$leadType',
                              filters.leadType.map(
                                (a) => new Types.ObjectId(a),
                              ),
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

      ...attendanceCountStages,

      ...(Object.keys(attendanceCountFilter).length > 0
        ? [{ $match: attendanceCountFilter }]
        : []),
    ];

    const mainPipeline: PipelineStage[] = [
      ...basePipeline,
      { $sort: { [sort.sortBy]: sort.sortOrder === SortOrder.ASC ? 1 : -1 } },
      { $skip: skip },
      { $limit: limit },
      ...(Array.isArray(filters.leadType) && filters.leadType.length > 0
        ? []
        : [
            {
              $lookup: {
                from: 'attendeeassociations',
                let: {
                  tempMail: '$email',
                  tempAdminId: new Types.ObjectId(`${adminId}`),
                },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          {
                            $eq: ['$adminId', '$$tempAdminId'],
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
      ...(formatLeadType
        ? [
            {
              $lookup: {
                from: 'customleadtypes',
                foreignField: '_id',
                localField: 'leadType',
                as: 'leadTypeDetails',
              },
            },
            {
              $unwind: {
                path: '$leadTypeDetails',
                preserveNullAndEmptyArrays: true,
              },
            },
            {
              $addFields: {
                leadType: '$leadTypeDetails.label',
              },
            },
            {
              $project: {
                leadTypeDetails: 0,
              },
            },
          ]
        : []),
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
          { assignedTo: new Types.ObjectId(`${data.user}`), status: null },
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

    await this.getEmployeeDailyContactCount({
      adminId: new Types.ObjectId(`${adminId}`),
      employeeId: new Types.ObjectId(`${data.user}`),
    });

    return { success: true, message: 'Assignment created successfully' };
  }

  //
  async addRandomAssignment(data: AssignmentDto, adminId: string) {
    const attendeeIds = data.attendees.map((a) => new Types.ObjectId(`${a}`));
    const adminObjectId = new Types.ObjectId(adminId);
    const webinarObjectId = new Types.ObjectId(data.webinar);
    const forceAssign = data.forceAssign === true; // Explicitly check for boolean true

    // --- 1. Initial Checks ---

    // Check if attendees are already assigned (Keep existing check)
    const assignedAttendeesCheck =
      await this.attendeeService.fetchAssigned(attendeeIds);

    if (assignedAttendeesCheck && assignedAttendeesCheck.length > 0) {
      const alreadyAssignedEmails = assignedAttendeesCheck
        .map((att) => att.email)
        .join(', ');
      throw new BadRequestException(
        `Some attendees are already assigned: ${alreadyAssignedEmails}`,
      );
    }

    // Get Webinar and check for assigned employees (Keep existing check)
    const webinar = await this.webinarService.getWebinar(data.webinar, adminId);

    if (!webinar) {
      throw new NotFoundException('Webinar not found');
    }

    if (
      !Array.isArray(webinar?.assignedEmployees) ||
      webinar.assignedEmployees.length === 0
    ) {
      throw new BadRequestException('No Assigned Employee Found on Webinar');
    }

    const employees = webinar.assignedEmployees; // These are likely populated Employee documents or objects

    // Determine the required role based on recordType
    let requiredRole = '';
    if (data.recordType === 'preWebinar') {
      requiredRole = this.configService.get('appRoles')['EMPLOYEE_REMINDER'];
    } else if (data.recordType === 'postWebinar') {
      requiredRole = this.configService.get('appRoles')['EMPLOYEE_SALES'];
    } else {
      throw new BadRequestException(`Invalid recordType: ${data.recordType}`);
    }

    // Filter employees by the required role
    const roleEmps = employees.filter(
      (emp) => String(emp?.role) === String(requiredRole),
    );

    if (!Array.isArray(roleEmps) || roleEmps.length === 0) {
      throw new BadRequestException(
        `No employees found with role: "${requiredRole}"`,
      );
    }

    // --- 2. Determine Employees for Assignment & Distribute Attendees ---

    const attendeeLogsToCreate: any[] = []; // Array to hold new attendee log documents
    const assignmentsToCreate: any[] = []; // Array to hold new assignment documents
    const attendeeBulkUpdates: any[] = []; // Array to hold attendee update operations
    const employeeDailyCountUpdates = new Map<string, number>(); // Map<employeeId, countIncrement>

    let attendeesAssignedCount = 0;
    const totalAttendeesToAssign = attendeeIds.length;

    // Filter for employees who initially have capacity (for the standard pass)
    const availableEmployees = roleEmps.filter(
      (emp) => (emp.dailyContactCount || 0) < (emp.dailyContactLimit || 0),
    );

    const attendeesData = await this.attendeeService.getAttendeesByIds(
      new Types.ObjectId(`${adminId}`),
      attendeeIds,
    );
    if (!attendeesData) {
      throw new NotFoundException('Attendee not found');
    }

    const attendeeIdToEmailMap = new Map<string, string>();
    attendeesData.forEach((attendee) => {
      attendeeIdToEmailMap.set(attendee._id.toString(), attendee.email);
    });

    const employeeIdTOUserNameMap = new Map<string, string>();

    roleEmps.forEach((employee) => {
      employeeIdTOUserNameMap.set(employee._id.toString(), employee.userName);
    });

    // NOTE: Even if availableEmployees is empty, if forceAssign is true, we proceed
    // as force assign uses *all* roleEmps. If forceAssign is false and availableEmployees is empty,
    // no standard assignments are possible, and the !assigned check will handle it.

    let currentEmployeeIndex = 0; // Index for the standard round-robin among *available* employees

    // Loop through each attendee to assign them
    for (const attendeeId of attendeeIds) {
      let assigned = false;
      let assignedEmployeeId: Types.ObjectId | null = null; // To store the ID of the employee ultimately assigned

      // --- Attempt Standard Assignment (Round Robin among Initially Available Employees) ---
      // This loop iterates through the `availableEmployees` array
      if (availableEmployees.length > 0) {
        const startEmployeeIndex = currentEmployeeIndex; // Track where we started searching

        do {
          const currentEmployee = availableEmployees[currentEmployeeIndex];
          const employeeIdStr = currentEmployee._id.toString();

          // Calculate current capacity used in this batch for this employee
          const assignedInBatch =
            employeeDailyCountUpdates.get(employeeIdStr) || 0;

          // Check if this employee *still* has capacity based on their original limit + assignments *in this batch*
          if (
            (currentEmployee.dailyContactCount || 0) + assignedInBatch <
            (currentEmployee.dailyContactLimit || 0)
          ) {
            // --- Standard Assignment Successful ---
            assignedEmployeeId = currentEmployee._id;
            assigned = true;

            // Move to the next employee for the *next* attendee (standard round-robin)
            currentEmployeeIndex =
              (currentEmployeeIndex + 1) % availableEmployees.length;

            break; // Found an employee, break the inner do/while loop
          }

          // If employee is full for this batch (in the context of standard limits), move to the next employee *within the do/while*
          currentEmployeeIndex =
            (currentEmployeeIndex + 1) % availableEmployees.length;
        } while (!assigned && currentEmployeeIndex !== startEmployeeIndex); // Loop until we find an employee or cycle back through available
      }

      // --- Handle Case Where Standard Assignment Failed ---
      if (!assigned) {
        // If after checking all available employees in the do/while loop (or if availableEmployees was empty),
        // the attendee wasn't assigned within standard limits.

        if (forceAssign) {
          // --- FORCE ASSIGNMENT LOGIC: Assign to Employee with Least Current Daily Count ---
          console.log(
            `Force assigning attendee ${attendeeId.toString()} as standard assignment failed.`,
          );

          let minCount = Infinity;
          let leastCountEmployee = null;

          // Iterate through ALL employees with the required role (`roleEmps`)
          for (const currentEmp of roleEmps) {
            const employeeIdStr = currentEmp._id.toString();
            // Get the count of assignments already made to this employee *in this batch*
            const assignedInBatch =
              employeeDailyCountUpdates.get(employeeIdStr) || 0;
            // Calculate their effective total count for the day (existing + in this batch)
            const effectiveCount =
              (currentEmp.dailyContactCount || 0) + assignedInBatch;

            // Find the minimum effective count and the corresponding employee
            if (effectiveCount < minCount) {
              minCount = effectiveCount;
              leastCountEmployee = currentEmp;
            }
          }

          // Assign to the least count employee if one was found (should always be true if roleEmps is not empty, which is checked earlier)
          if (leastCountEmployee) {
            assignedEmployeeId = leastCountEmployee._id;
            assigned = true;
            console.log(
              `Force assigned attendee ${attendeeId.toString()} to employee ${assignedEmployeeId.toString()} (effective count: ${minCount})`,
            );
            // Note: Force assignment doesn't change the `currentEmployeeIndex` which is used
            // for the *next* attendee's *standard* assignment attempt.
          } else {
            // This case should ideally not happen given the roleEmps check earlier, but added for robustness.
            console.error(
              `Could not find a least count employee for attendee ${attendeeId.toString()} even with forceAssign (roleEmps empty?).`,
            );
            // Attendee remains unassigned in this scenario
          }
        } else {
          // Not force assign, and standard assignment failed
          console.warn(
            `Attendee ${attendeeId.toString()} could not be assigned due to employee daily limits (forceAssign is false).`,
          );
          // Attendee remains unassigned. Do not increment attendeesAssignedCount.
          // The original code included a 'break;' here to stop processing remaining attendees.
          // Removing 'break' means we attempt to assign *all* attendees from the input list,
          // but some might be skipped if forceAssign is false and limits are hit.
          // Let's remove the break to process the whole list.
          // break; // Removed break to process all input attendees
        }
      } // End if (!assigned) after standard attempt

      // --- If Assigned (Either Standard or Force), Prepare Database Operations ---
      if (assigned && assignedEmployeeId) {
        const employeeIdStr = assignedEmployeeId.toString();

        // Prepare assignment document
        assignmentsToCreate.push({
          adminId: adminObjectId,
          user: assignedEmployeeId, // This is the assigned employee's ID
          webinar: webinarObjectId,
          attendee: attendeeId,
          recordType: data.recordType,
          status: AssignmentStatus.ACTIVE,
        });

        // Prepare attendee update operation
        attendeeBulkUpdates.push({
          updateOne: {
            filter: { _id: attendeeId, adminId: adminObjectId },
            update: { assignedTo: assignedEmployeeId, status: null },
          },
        });

        const webinarName = webinar?.webinarName || 'Webinar';
        const webinarType =
          data.recordType === 'preWebinar' ? 'Reminder' : 'Sales';
        const email =
          attendeeIdToEmailMap.get(attendeeId.toString()) || 'Unknown';
        const userName =
          employeeIdTOUserNameMap.get(employeeIdStr) || 'Unknown';

        attendeeLogsToCreate.push({
          attendee: email,
          action: AttendeeAction.ASSIGNMENT,
          item: webinarName,
          details: `<span>Attendee has been assigned to <strong>${userName}</strong> in the <strong>${webinarType}</strong> webinar : <strong>${webinarName}</strong></span>`,
          adminId: new Types.ObjectId(`${adminId}`),
        });

        // Track count increase for this employee in this batch
        const currentAssignedInBatch =
          employeeDailyCountUpdates.get(employeeIdStr) || 0;
        employeeDailyCountUpdates.set(
          employeeIdStr,
          currentAssignedInBatch + 1,
        );

        attendeesAssignedCount++; // Increment total count of successfully assigned attendees
      }
    } // End for (const attendeeId of attendeeIds)

    // If no assignments were created despite having attendees and employees,
    // it means either attendeeIds was empty, or no assignable employees were found
    // even in force mode (e.g., roleEmps was empty, though checked earlier).
    // The check `assignmentsToCreate.length === 0` handles the end result correctly.
    if (assignmentsToCreate.length === 0 && totalAttendeesToAssign > 0) {
      // If totalAttendeesToAssign > 0 but no assignments were created, something prevented it.
      // This might happen if roleEmps was somehow empty or if there's another unexpected issue.
      // The check `assignmentsToCreate.length === 0` below is more reliable before the transaction.
      console.warn(
        'No assignments created despite input attendees and available employees:',
        { totalAttendeesToAssign, assignedCount: attendeesAssignedCount },
      );
    }

    // --- 3. Perform Database Operations within Transaction ---

    // Check if any assignments were generated at all *after* the distribution logic
    if (assignmentsToCreate.length === 0) {
      // This handles the case where attendeeIds was empty or no assignable employees were found
      // in either force or non-force mode after role filtering.
      return {
        success: true,
        message: 'No assignable attendees or available employees found.',
        assignedCount: 0,
        unassignedCount: totalAttendeesToAssign,
      };
    }

    const session = await this.assignmentsModel.startSession(); // Start transaction session
    try {
      await session.withTransaction(async (currentSession) => {
        // 3.1. Update Attendees with assignedTo field
        if (attendeeBulkUpdates.length > 0) {
          // Note: We only update attendees that were successfully assigned.
          const updateAttendeesResult =
            await this.attendeeService.bulkUpdateAttendees(
              attendeeBulkUpdates, // Pass the operations array generated above
              currentSession, // Pass the session
            );

          // We expect matchedCount to equal the number of update operations we prepared
          if (
            updateAttendeesResult.matchedCount !== attendeeBulkUpdates.length
          ) {
            console.error(
              'Mismatch in attendee update matched count:',
              updateAttendeesResult,
              `Expected: ${attendeeBulkUpdates.length}, Matched: ${updateAttendeesResult.matchedCount}`,
            );
            // Consider whether to throw here or just log a warning. Throwing is safer in a transaction.
            throw new InternalServerErrorException(
              'Failed to update all attendee assignments during transaction.',
            );
          }
        }

        // 3.2. Create new Assignments
        const createdAssignments = await this.assignmentsModel.insertMany(
          assignmentsToCreate, // Pass the assignment documents generated above
          { session: currentSession },
        );

        if (
          !createdAssignments ||
          createdAssignments.length !== assignmentsToCreate.length
        ) {
          console.error(
            'Mismatch in created assignments count:',
            createdAssignments ? createdAssignments.length : 0,
            assignmentsToCreate.length,
          );
          throw new InternalServerErrorException(
            'Failed to create all new assignments during transaction',
          );
        }

        // 3.3. Update Employee dailyContactCount
        // Prepare bulkWrite operations for employees based on the map populated above
        const employeeBulkUpdates = Array.from(
          employeeDailyCountUpdates.entries(),
        ).map(([empId, count]) => ({
          updateOne: {
            filter: { _id: new Types.ObjectId(empId) },
            // Use $inc to atomically increment the count
            update: { $inc: { dailyContactCount: count } },
          },
        }));

        if (employeeBulkUpdates.length > 0) {
          // Use the userService method to perform the bulk update on users (employees)
          // Note: Ensure userService.bulkUpdateUsersDailyContactCount exists and uses the session
          const updateEmployeesResult =
            await this.userService.bulkUpdateUsersDailyContactCount(
              employeeBulkUpdates,
              currentSession,
            );

          // Optional: Check employee update results. A mismatch here might mean an employee ID was invalid.
          // We don't necessarily need to fail the transaction for this, but it's worth logging.
          if (
            updateEmployeesResult.matchedCount !== employeeBulkUpdates.length
          ) {
            console.warn(
              'Mismatch in employee dailyContactCount update matched count:',
              updateEmployeesResult,
              `Expected: ${employeeBulkUpdates.length}, Matched: ${updateEmployeesResult.matchedCount}`,
            );
            // Decide if this is a critical error or just a warning. Log as warning for now.
          }
        }

        if (attendeeLogsToCreate.length > 0) {
          await this.attendeeLogService.createAttendeeLogs(
            attendeeLogsToCreate,
            currentSession,
          );
        }

        // If everything succeeded, the transaction will commit implicitly here
      });

      // Transaction successful
    } catch (error) {
      // Transaction failed
      console.error('Transaction failed during assignment creation:', error);
      // Re-throw the original error after logging
      throw error;
    } finally {
      // Ensure the session is ended regardless of success or failure
      await session.endSession();
    }

    const webinarKaName = webinar?.webinarName || 'Webinar';

    const employeeeNotifications = Array.from(
      employeeDailyCountUpdates.entries(),
    ).map(([empId, count]) => {
      if (count > 0) {
        return {
          recipient: empId,
          title: 'New Tasks Assigned',
          message: `You have been assigned ${count} new tasks in ${webinarKaName}. Please check your task list for details.`,
          type: notificationType.INFO,
          actionType: notificationActionType.ASSIGNMENT,
          metadata: {
            webinarId: data.webinar,
          },
        };
      }
    });

    for (const notification of employeeeNotifications) {
      if (notification) {
        await this.notificationService.createNotification(notification);
      }
    }

    // --- 4. Return Result ---
    const unassignedCount = totalAttendeesToAssign - attendeesAssignedCount;
    let message = `${attendeesAssignedCount} attendee(s) assigned successfully.`;
    if (unassignedCount > 0) {
      // Provide more context on why some weren't assigned
      if (forceAssign) {
        message += ` ${unassignedCount} attendee(s) could not be assigned. This is unexpected in force assign mode (maybe no eligible employees found?).`;
      } else {
        message += ` ${unassignedCount} attendee(s) could not be assigned due to employee daily limits.`;
      }
    }

    return {
      success: true,
      message: message,
      assignedCount: attendeesAssignedCount,
      unassignedCount: unassignedCount,
    };
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
  ): Promise<{
    executeFurther: boolean;
    AssignmentResponse: any;
  }> {
    const webinarId = webinar._id.toString();
    const attendeeId = attendee?._id;
    let executeFurther = true;
    let AssignmentResponse = {};
    for (const tag of tags) {
      if (Array.isArray(assignedProducts)) {
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
              await this.enrollmentService.createEnrollment({
                attendee: attendeeEmail,
                product: product._id,
                productName: product.name,
                adminId: adminId.toString(),
                webinar: webinarId,
                webinarName: webinar.webinarName,
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
          AssignmentResponse = await this.createNewAssignmentForPreWebinar(
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
    return {
      executeFurther,
      AssignmentResponse,
    };
  }

  async addPreWebinarAssignments(
    adminId: string,
    webinarId: string,
    attendee: PreWebinarPostAttendeeDTO,
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

    if (!Array.isArray(newAttendees) || newAttendees.length === 0) {
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

    // Fire-and-forget: auto message on registration (do not block assignment flow)
    try {
      const contactPhone = newAttendee.phone;
      if (contactPhone) {
      
        this.autoMessageService
        .sendForRegistration(
          adminId,
          webinarId,
          {
            phoneNumber: contactPhone,
            email: newAttendee.email,
            firstName: newAttendee.firstName,
            lastName: newAttendee.lastName,
          },
        )
        .catch(() => {});
      }
    } catch {}

    this.attendeeLogService.createSingleAttendeeLog({
      attendee: newAttendee.email,
      action: AttendeeAction.REGISTERED,
      item: 'Attendee',
      details: `<span>Attendee registered by API for <strong>Reminder</strong> webinar : <strong>${webinar?.webinarName}</strong></span>`,
      adminId: new Types.ObjectId(adminId),
    });

    const { executeFurther, AssignmentResponse } = await this.handleTags(
      newAttendee,
      newAttendee.email,
      webinar,
      new Types.ObjectId(adminId),
      newAttendee.tags,
      webinar.productIds,
      webinar.assignedEmployees,
    );

    if (!executeFurther) {
      return AssignmentResponse;
    }

    if (webinar.autoAssignmentDisabled) {
      return {
        success: true,
        message: 'Attendee has been created, Auto Assignment is Disabled.',
        data: { newAttendee },
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

    console.log('last assigned --> ', lastAssigned);

    const excludedEmployees = Array.isArray(webinar.excludedEmployees)
      ? webinar.excludedEmployees.map((a) => `${a}`)
      : [];

    // If previously assigned, check if the same employee can be reassigned
    if (lastAssigned && lastAssigned.assignedTo) {
      const isEmployeeAssignedToWebinar = webinar.assignedEmployees.some(
        (employee) => {
          return (
            employee._id.toString() === lastAssigned.assignedTo.toString() &&
            employee.role.toString() ===
              this.configService.get('appRoles')['EMPLOYEE_REMINDER'] &&
            employee.isActive
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
          employee.dailyContactLimit > employee.dailyContactCount &&
          !excludedEmployees.includes(`${employee._id}`)
        ) {
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
            this.configService.get('appRoles').EMPLOYEE_REMINDER &&
          !excludedEmployees.includes(`${emp._id}`),
      );

      const employees = filteredEmployee.sort(
        (a, b) => a.dailyContactCount - b.dailyContactCount,
      );

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
    const employeeId = employee._id as Types.ObjectId;
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
    await this.getEmployeeDailyContactCount({
      adminId: new Types.ObjectId(`${adminId}`),
      employeeId,
    });

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
        details: `<span><strong>${userName}</strong> requested reassignment in webinar <strong>${webinarName}</strong>, reason: <strong>${requestReason}</strong></span>`,
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
        details: `<span><strong>${userName}</strong> cancelled the request for reassignment in <strong>${recordType === 'preWebinar' ? 'Reminder' : 'Sales'}</strong> webinar : <strong>${webinarName}</strong></span>`,
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
            details: `<span>Reassignment request approved in webinar : <strong>${webinarName}</strong></span>`,
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
          details: `<span>Reassignment request Rejected in webinar : <strong>${webinarName}</strong></span>`,
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
      let employeeId: any = null;
      let webinarKaName: any = null;
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
              details: `<span>Attendee Reassigned to <strong>${employee.userName}</strong> <strong>${data.isTemp ? 'temporarily' : 'Permanently'}</strong> in webinar : <strong>${webinarName}</strong></span>`,
              adminId: new Types.ObjectId(`${adminId}`),
            }));

            await this.attendeeLogService.createAttendeeLogs(
              logs,
              currentSession,
            );
          }
        }

        employeeId = employee._id.toString();
        webinarKaName = webinarName;
        updatedAssignmentsCount = deletedAssignmentsResult.deletedCount;
        updatedAttendeesCount = updatedAttendeesResult.matchedCount;
        newAssignments = createdAssignments;
      });
      if (newAssignments?.length && employeeId && webinarKaName) {
        await this.notificationService.createNotification({
          recipient: employeeId,
          title: 'New Tasks Assigned',
          message: `You have been assigned ${newAssignments.length} new tasks ${data.isTemp ? 'temporarily' : ''} in the webinar ${webinarKaName} . Please check your task list for details.`,
          type: notificationType.INFO,
          actionType: notificationActionType.REASSIGNMENT,
          metadata: {
            webinarId: data.webinarId,
          },
        });
      }
      await this.getEmployeeDailyContactCount({
        adminId: new Types.ObjectId(`${adminId}`),
      });
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

        await this.getEmployeeDailyContactCount({
          adminId: new Types.ObjectId(`${adminId}`),
        });

        const attendees = await this.attendeeService.getAttendeesByIds(
          new Types.ObjectId(`${adminId}`),
          attendeeIds,
        );

        if (attendees?.length) {
          const webinar = await this.webinarService.getWebinarById(webinarId);
          const webinarName = webinar?.webinarName || 'Webinar';

          const logs = attendees.map((attendee) => ({
            attendee: attendee.email,
            action: AttendeeAction.PULLBACK,
            item: webinarName,
            details: `<span>Attendee has been Pulled back in webinar : <strong>${webinarName}</strong></span>`,
            adminId: new Types.ObjectId(`${adminId}`),
          }));

          await this.attendeeLogService.createAttendeeLogs(logs);
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

      const webinar = await this.webinarService.getWebinarById(webinarId);

      if (!webinar) {
        throw new NotFoundException('Webinar does not exist.');
      }

      let tempEmployees = [];
      const assignedEmployees = webinar.assignedEmployees || [];

      const isPresent = assignedEmployees.some(
        (item) => `${item}` === `${employeeId}`, // Ensure type-safe comparison
      );

      if (!isPresent) {
        // Add the new employeeId to the list
        tempEmployees = [...assignedEmployees, employeeId];

        // Optionally, update the webinar document with new assignedEmployees
        this.webinarService.updateAssignedEmployees(
          webinar._id as Types.ObjectId,
          tempEmployees,
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

  async checkAssignmentExists(
    employees: Types.ObjectId[],
    webinarId: Types.ObjectId,
  ) {
    const result = await this.assignmentsModel.find({
      user: {
        $in: employees,
      },
      webinar: webinarId,
    });
    return Array.isArray(result) && result.length > 0;
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
          userName: {
            $arrayElemAt: ['$userData.userName', 0],
          },
        },
      },
    ];

    return this.assignmentsModel
      .aggregate(pipeline, { allowDiskUse: true })
      .exec();
  }

  async getRevisedAssignments(
    startDate: Date,
    endDate: Date,
    adminId: Types.ObjectId,
    webinar?: Types.ObjectId,
  ) {
    const pipeline = [
      // --- Your initial stages are correct ---
      {
        $match: {
          adminId,
          status: AssignmentStatus.ACTIVE,
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
        $lookup: {
          from: 'attendees',
          localField: 'attendee',
          foreignField: '_id',
          as: 'attendeeData',
        },
      },
      {
        $unwind: {
          path: '$attendeeData',
          preserveNullAndEmptyArrays: true,
        },
      },

      // --- Group by user to get preliminary counts and the raw status list ---
      {
        $group: {
          _id: '$user', // Grouping by user as requested

          // 1. Count of total assignments
          totalAssignments: { $sum: 1 },

          // 2. Count where status exists
          statusExists: {
            $sum: {
              $cond: [{ $ne: ['$attendeeData.status', null] }, 1, 0],
            },
          },

          // 3. Count where status is null or does not exist
          statusNotExists: {
            $sum: {
              $cond: [{ $eq: ['$attendeeData.status', null] }, 1, 0],
            },
          },

          // 4. Count where validCall is true
          validCallCount: {
            $sum: {
              $cond: [{ $eq: ['$attendeeData.validCall', true] }, 1, 0],
            },
          },

          // 5. Collect all non-null statuses into an array for processing in the next stage
          existingStatusList: {
            $push: {
              $cond: [
                { $ne: ['$attendeeData.status', null] },
                '$attendeeData.status',
                '$$REMOVE',
              ],
            },
          },
        },
      },

      // --- Use $project to transform the array and format the final output ---
      {
        $project: {
          _id: 0, // Hide the original _id field
          user: '$_id', // Rename _id to 'user' for clarity
          totalAssignments: 1, // Keep the calculated fields
          statusExists: 1,
          statusNotExists: 1,
          validCallCount: 1,

          // The core logic to create the grouped status counts
          groupedStatuses: {
            // Use $let to define a variable for unique statuses, making the query cleaner
            $let: {
              vars: {
                // Step 1: Create an array of unique statuses from our list
                uniqueStatuses: { $setUnion: '$existingStatusList' },
              },
              in: {
                // Step 2: Map over the array of unique statuses
                $map: {
                  input: '$$uniqueStatuses',
                  as: 'status',
                  in: {
                    // Step 3: For each unique status, create an object
                    status: '$$status',
                    // And calculate its count
                    count: {
                      // Step 4: To count, filter the original list to get only items matching the current status
                      $size: {
                        $filter: {
                          input: '$existingStatusList',
                          as: 'item',
                          cond: { $eq: ['$$item', '$$status'] },
                        },
                      },
                    },
                  },
                },
              },
            },
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

  async getActiveAssignmentByAttendeeId(attendee: Types.ObjectId) {
    return this.assignmentsModel
      .findOne({ attendee, status: AssignmentStatus.ACTIVE })
      .exec();
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

  async getRevisedEmployeeAssignments(
    startDate: Date,
    endDate: Date,
    user: Types.ObjectId,
    webinar?: Types.ObjectId,
  ) {
    const pipeline: PipelineStage[] = [
      // --- Start with your initial stages ---
      {
        $match: {
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
        },
      },
      {
        $lookup: {
          from: 'attendees',
          localField: 'attendee',
          foreignField: '_id',
          as: 'attendeeData',
        },
      },
      {
        $unwind: {
          path: '$attendeeData',
          preserveNullAndEmptyArrays: true, // Keep assignments even if they have no attendee
        },
      },

      // --- Use $facet to run multiple aggregations at once ---
      {
        $facet: {
          // --- Pipeline 1: Calculate overall counts ---
          overallCounts: [
            {
              $group: {
                _id: null,
                // 1. Count of total assignments
                totalAssignments: { $sum: 1 },

                // 2. Count where status exists and is not null
                statusExists: {
                  $sum: {
                    $cond: [{ $ne: ['$attendeeData.status', null] }, 1, 0],
                  },
                },

                // 3. Count where status is null or does not exist
                statusNotExists: {
                  $sum: {
                    $cond: [{ $eq: ['$attendeeData.status', null] }, 1, 0],
                  },
                },

                // 4. Count where validCall is true
                validCallCount: {
                  $sum: {
                    $cond: [{ $eq: ['$attendeeData.validCall', true] }, 1, 0],
                  },
                },
              },
            },
          ],

          // --- Pipeline 2: Group counts by status value ---
          statusCounts: [
            {
              // Only consider documents where status is not null
              $match: {
                'attendeeData.status': { $ne: null },
              },
            },
            {
              $group: {
                _id: '$attendeeData.status',
                count: { $sum: 1 },
              },
            },
            {
              // Format the output to be more readable
              $project: {
                _id: 0,
                status: '$_id',
                count: '$count',
              },
            },
            {
              // Optional: sort by the most common status
              $sort: { count: -1 },
            },
          ],
        },
      },

      // --- Final stage to combine the results from $facet into one object ---
      {
        $project: {
          _id: 0,
          // Get the single object from the 'overallCounts' array
          totalAssignments: {
            $arrayElemAt: ['$overallCounts.totalAssignments', 0],
          },
          statusExists: { $arrayElemAt: ['$overallCounts.statusExists', 0] },
          statusNotExists: {
            $arrayElemAt: ['$overallCounts.statusNotExists', 0],
          },
          validCallCount: {
            $arrayElemAt: ['$overallCounts.validCallCount', 0],
          },
          // The 'statusCounts' field is already in the correct array format
          groupedStatuse: '$statusCounts',
        },
      },
    ];
    const result = await this.assignmentsModel.aggregate(pipeline).exec();
    if (Array.isArray(result) && result.length > 0) return result[0];
    return {};
  }

  async getEmployeeDailyContactCount({
    adminId,
    employeeId,
    session,
  }: {
    adminId: Types.ObjectId;
    employeeId?: Types.ObjectId;
    session?: ClientSession;
  }) {
    const now = new Date();

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

    const startOfISTDay = new Date(endOfISTDay.getTime() - 24 * 60 * 60 * 1000);

    const filter = {
      adminId,
      status: AssignmentStatus.ACTIVE,
      createdAt: {
        $gte: startOfISTDay,
        $lt: endOfISTDay,
      },
    };

    if (mongoose.isValidObjectId(employeeId)) {
      filter['user'] = employeeId;

      const totalAssignments =
        await this.assignmentsModel.countDocuments(filter);

      return await this.userService.updateDailyContactCountSingle(
        totalAssignments,
        employeeId,
      );
    }

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
