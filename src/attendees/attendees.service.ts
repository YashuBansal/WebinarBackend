import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model, PipelineStage, Types } from 'mongoose';
import { Attendee } from 'src/schemas/Attendee.schema';
import {
  AttendeesFilterDto,
  CreateAttendeeDto,
  GroupedAttendeesFilterDto,
  GroupedAttendeesSortBy,
  GroupedAttendeesSortObject,
  PreWebinarPostAttendeeDTO,
  SortOrder,
  SwapAttendeeFieldsDTO,
  UpdateAttendeeDto,
  WebinarAttendeesSortBy,
  WebinarAttendeesSortObject,
} from './dto/attendees.dto';
import { ConfigService } from '@nestjs/config';
import { UsersService } from 'src/users/users.service';
import {
  notificationActionType,
  notificationType,
} from 'src/schemas/notification.schema';
import { NotificationService } from 'src/notification/notification.service';
import { WebinarService } from 'src/webinar/webinar.service';
import { SubscriptionService } from 'src/subscription/subscription.service';
import { WebsocketGateway } from 'src/websocket/websocket.gateway';
import { ClientSession } from 'mongoose';
import { DeleteResult } from 'mongodb';
import { AssignmentService } from 'src/assignment/assignment.service';
import async from 'async';
import { AlarmService } from 'src/alarm/alarm.service';
import { EnrollmentsService } from 'src/enrollments/enrollments.service';
import { NotesService } from 'src/notes/notes.service';
import { AttendeeAssociationService } from 'src/attendee-association/attendee-association.service';
import { AttendeeLogService } from 'src/attendee-log/attendee-log.service';
import { AttendeeAction } from 'src/schemas/attendee-logs.schema';
import { CustomLeadTypeService } from 'src/custom-lead-type/custom-lead-type.service';
import { WebinarParticipantDto } from 'src/webinar-participant/dto/webinar-participant.dto';
import { WebinarParticipantService } from 'src/webinar-participant/webinar-participant.service';
import { TagsService } from 'src/tags/tags.service';

@Injectable()
export class AttendeesService {
  constructor(
    @InjectModel(Attendee.name) private attendeeModel: Model<Attendee>,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => UsersService))
    private readonly userService: UsersService,
    private readonly notificationService: NotificationService,
    @Inject(forwardRef(() => WebinarService))
    private readonly webinarService: WebinarService,
    @Inject(forwardRef(() => AssignmentService))
    private readonly assignService: AssignmentService,
    @Inject(forwardRef(() => SubscriptionService))
    private readonly subscriptionService: SubscriptionService,
    private readonly websocketGateway: WebsocketGateway,
    private readonly alarmService: AlarmService,
    private readonly enrollService: EnrollmentsService,
    private readonly notesService: NotesService,
    private readonly attendeeAssociationService: AttendeeAssociationService,
    private readonly attendeeLogService: AttendeeLogService,
    private readonly customLeadTypeService: CustomLeadTypeService,
    private readonly webinarParticipantService: WebinarParticipantService,
    private readonly tagService: TagsService,
  ) {}


  async getAttendeesCount(webinarId:Types.ObjectId, tags: string[], adminId: Types.ObjectId): Promise<number> {
    const attendees = await this.attendeeModel.
    countDocuments({
      webinar: webinarId,
      adminId: adminId,
      ...(tags?.length > 0 && { tags: { $in: tags } }),
      isAttended: false,
    })
    return attendees
  }

  async getAttendeesCountMultipleWebinars(webinarIds: Types.ObjectId[], tags: string[], adminId: Types.ObjectId): Promise<number> {
    
    console.log(webinarIds, tags, adminId);
    
    // Build the query object
    const query: any = {
      webinar: { $in: webinarIds },
      adminId: adminId,
      isAttended: false,
    };
    
    // If tags are provided, filter attendees that have ANY of these tags
    // MongoDB's $in with array fields checks if the array contains any of the specified values
    if (tags?.length > 0) {
      query.tags = { $in: tags };
    }
    
    const attendees = await this.attendeeModel.countDocuments(query);
    return attendees
  }

  async addAttendees(attendees: [PreWebinarPostAttendeeDTO]): Promise<any> {
    const result = await this.attendeeModel.create(attendees);
    return result;
  }

  checkLength(arr?: string[]): boolean {
    return !!(Array.isArray(arr) && arr.length);
  }

  emitProgress(socketId: null | string, value: number) {
    if (socketId) {
      this.websocketGateway.server.to(socketId).emit('import-export', {
        actionType: 'import',
        value: value,
      });
    }
  }

  async addPostAttendees(
    attendees: CreateAttendeeDto[],
    webinar: string,
    isAttended: boolean,
    adminId: string,
    postWebinarExists: boolean,
    webinarName: string,
    unMergedData?: WebinarParticipantDto[],
  ): Promise<any> {
    const subscription =
      await this.subscriptionService.getSubscription(adminId);

    const contactCountDiff =
      subscription.contactLimit - subscription.contactCount;

    if (contactCountDiff <= 0) {
      throw new BadRequestException('Contact Limit Exceeded');
    }
    let tempAttendees = attendees;

    const socketId = this.websocketGateway.activeUsers.get(String(adminId));
    let lastProgress = 0;
    const updateProgress = (current) => {
      if (current - lastProgress >= 5) {
        // 5% increments
        this.emitProgress(socketId, current);
        lastProgress = current;
      }
    };

    let attendeesForUpdate: CreateAttendeeDto[] = [];
    if (!isAttended || (postWebinarExists && isAttended)) {
      const prevAttendees = await this.attendeeModel.find({
        webinar: new Types.ObjectId(`${webinar}`),
        adminId: new Types.ObjectId(`${adminId}`),
        isAttended: isAttended,
      });
      updateProgress(15);
      if (prevAttendees.length > 0) {
        const prevAttendeesMap = new Map(
          prevAttendees.map((a) => [a.email, a]),
        );

        const newAttendees = attendees.filter(
          (a) => !prevAttendeesMap.has(a.email),
        );
        tempAttendees = newAttendees;

        const prevAttendeesToUpdate = attendees.filter((a) =>
          prevAttendeesMap.has(a.email),
        );

        // Deduplicate by email
        const uniqueEmails = new Set();
        const uniquePrevAttendeesToUpdate = prevAttendeesToUpdate.filter(
          (a) => {
            if (uniqueEmails.has(a.email)) {
              return false;
            }
            uniqueEmails.add(a.email);
            return true;
          },
        );

        attendeesForUpdate = uniquePrevAttendeesToUpdate.map((attendee) => {
          let tags = '';
          if (typeof attendee.tags === 'string') {
            const tagArray = Array.from(
              new Set(
                attendee.tags
                  .split(',')
                  .map((tag) => tag.toLowerCase().trim())
                  .filter(Boolean),
              ),
            );

            tags = tagArray.join(',');
          }

          const obj = {
            ...attendee,
            phone: attendee.phone || prevAttendeesMap.get(attendee.email).phone,
            attendeeId: prevAttendeesMap.get(attendee.email)
              ._id as Types.ObjectId,
            tags,
          };
          return obj;
        });
        // console.log('attendes for update', attendeesForUpdate)
      }
    }

    if (isAttended) {
      const similarPreWebinarAttendees = await this.attendeeModel.find({
        webinar: new Types.ObjectId(`${webinar}`),
        adminId: new Types.ObjectId(`${adminId}`),
        isAttended: false,
        email: { $in: attendees.map((a) => a.email) },
      });

      const similarPreWebinarAttendeesMap = new Map();
      similarPreWebinarAttendees.forEach((attendee) => {
        similarPreWebinarAttendeesMap.set(attendee.email, attendee);
      });

      tempAttendees = tempAttendees.map((attendee) => {
        let location = attendee.location || null;
        let source = attendee.source || null;
        let gender = attendee.gender || null;
        let tags = attendee.tags || '';
        if (similarPreWebinarAttendeesMap.has(attendee.email)) {
          const preWebinarAttendee = similarPreWebinarAttendeesMap.get(
            attendee.email,
          );
          location = location || preWebinarAttendee.location || null;
          source = source || preWebinarAttendee.source || null;
          gender = gender || preWebinarAttendee.gender || null;
          const preWebinarTags = Array.isArray(preWebinarAttendee.tags)
            ? preWebinarAttendee.tags
            : [];
          const newTags = tags.split(',').map((tag) => tag.trim());
          tags = Array.from(new Set([...preWebinarTags, ...newTags]))
            .filter((tag) => tag.trim() !== '')
            .join(',');
        }

        return {
          ...attendee,
          location,
          source,
          gender,
          tags,
        };
      });
      console.log(similarPreWebinarAttendeesMap);

      attendeesForUpdate = attendeesForUpdate.map((attendee) => {
        let tags = attendee.tags || '';
        console.log(
          similarPreWebinarAttendeesMap.has(attendee.email),
          attendee.tags,
        );
        if (similarPreWebinarAttendeesMap.has(attendee.email)) {
          const preWebinarAttendee = similarPreWebinarAttendeesMap.get(
            attendee.email,
          );
          const preWebinarTags = Array.isArray(preWebinarAttendee.tags)
            ? preWebinarAttendee.tags
            : [];
          const newTags = tags.split(',').map((tag) => tag.trim());
          console.log(preWebinarTags, newTags);

          tags = Array.from(new Set([...preWebinarTags, ...newTags]))
            .filter((tag) => tag.trim() !== '')
            .join(',');
        }

        return {
          ...attendee,
          tags,
        };
      });

      // console.log('atendd',attendeesForUpdate)
    }

    const allLastNamesBlank = tempAttendees.every(
      (attendee) => !attendee.lastName || attendee.lastName.trim() === '',
    );

    const someFirstNamePresent = tempAttendees.some(
      (attendee) => attendee.firstName && attendee.firstName.trim() !== '',
    );

    if (allLastNamesBlank && someFirstNamePresent) {
      tempAttendees.forEach((attendee) => {
        if (attendee.firstName && attendee.firstName.trim() !== '') {
          const parts = attendee.firstName.trim().split(' ');
          attendee.firstName = parts[0];
          attendee.lastName = parts.slice(1).join(' ') || '';
        }
      });
    }

    if (isAttended && !postWebinarExists) {
      const unattendedAttendees: CreateAttendeeDto[] =
        await this.getPreWebinarUnattendedData(
          new Types.ObjectId(`${adminId}`),
          new Types.ObjectId(`${webinar}`),
          attendees.map((a) => a.email),
        );
      updateProgress(20);

      if (unattendedAttendees.length > 0) {
        tempAttendees = [...tempAttendees, ...unattendedAttendees];
      }
    }

    const nonUniqueEmailCount = await this.getNonUniqueAttendeesCount(
      tempAttendees.map((a) => a.email),
      new Types.ObjectId(`${adminId}`),
    );
    updateProgress(25);
    const uniqueEmailsCount = tempAttendees.length - nonUniqueEmailCount;

    if (uniqueEmailsCount > contactCountDiff) {
      throw new BadRequestException('Contact Limit Exceeded');
    }

    const attendeesWithoutPhone = tempAttendees.filter((a) => !a.phone);

    if (attendeesWithoutPhone.length > 0) {
      const phoneNumbers = await this.getAttendeePhoneNumbers(
        new Types.ObjectId(`${adminId}`),
        attendeesWithoutPhone.map((a) => a.email),
      );
      updateProgress(30);

      const phoneMap = new Map(phoneNumbers.map((a) => [a._id, a.phone]));

      tempAttendees = tempAttendees.map((a) => ({
        ...a,
        phone: a.phone || (phoneMap.has(a.email) ? phoneMap.get(a.email) : ''),
      }));
    }

    const session = await this.attendeeModel.startSession();

    try {
      await session.withTransaction(async (currentSession) => {
        if (attendeesForUpdate.length > 0) {
          const bulkOps = attendeesForUpdate.map((attendee) => ({
            updateOne: {
              filter: { _id: attendee.attendeeId },
              update: {
                $set: {
                  firstName: attendee.firstName || undefined,
                  lastName: attendee.lastName || undefined,
                  phone: attendee.phone || undefined,
                  gender: attendee.gender || undefined,
                  timeInSession: attendee.timeInSession || undefined,
                  location: attendee.location || undefined,
                  source: attendee.source || undefined,
                  tags:
                    typeof attendee.tags === 'string' &&
                    attendee.tags.trim() !== ''
                      ? attendee.tags.split(',')
                      : [],
                },
              },
            },
          }));
          await this.attendeeModel.bulkWrite(bulkOps, {
            session: currentSession,
          });

          await this.enrollService.createUpdateEnrollments(
            attendeesForUpdate.map((attendee) => ({
              email: attendee.email,
              tags:
                typeof attendee.tags === 'string'
                  ? attendee.tags
                      .split(',')
                      .map((tag) => tag.toLowerCase().trim())
                      .filter(Boolean)
                  : [],
            })),
            new Types.ObjectId(`${webinar}`),
            new Types.ObjectId(`${adminId}`),
            currentSession,
          );

          updateProgress(50);
        }

        if (
          isAttended &&
          Array.isArray(unMergedData) &&
          unMergedData.length > 0
        ) {
          const data = unMergedData.map((data) => ({
            ...data,
            adminId: new Types.ObjectId(`${adminId}`),
            webinar: new Types.ObjectId(`${webinar}`),
          }));
          await this.webinarParticipantService.createMany(
            data,
            new Types.ObjectId(`${adminId}`),
            new Types.ObjectId(`${webinar}`),
            currentSession,
          );
        }

        updateProgress(70);

        const newAttendees = await this.attendeeModel.insertMany(
          tempAttendees.map((attendee) => ({
            ...attendee,
            tags:
              typeof attendee.tags === 'string' ? attendee.tags.split(',') : [],
          })),
          {
            session: currentSession,
          },
        );

        await this.enrollService.createEnrollments(
          tempAttendees.map((attendee) => ({
            email: attendee.email,
            tags:
              typeof attendee.tags === 'string'
                ? attendee.tags
                    .split(',')
                    .map((tag) => tag.toLowerCase().trim())
                    .filter(Boolean)
                : [],
          })),
          new Types.ObjectId(`${webinar}`),
          new Types.ObjectId(`${adminId}`),
          currentSession,
        );

        await this.attendeeLogService.createMultipleAttendeeLog({
          attendees: tempAttendees,
          adminId: new Types.ObjectId(`${adminId}`),
          webinarName,
          session: currentSession,
          isAttended,
        });

        updateProgress(75);
        const assignedEmployees =
          await this.webinarService.getAssignedEmployees(webinar);

        const role = isAttended
          ? this.configService.get('appRoles')['EMPLOYEE_SALES']
          : this.configService.get('appRoles')['EMPLOYEE_REMINDER'];

        const empData: {
          id: Types.ObjectId;
          userName: string;
          contactLimit: number;
          attendees: any[];
          assignMents: any[];
          contactCount: number;
        }[] = assignedEmployees
          .filter((emp) => emp.role.toString() === role)
          .map((emp) => ({
            id: emp._id,
            userName: emp.userName,
            contactLimit: emp.dailyContactLimit - emp.dailyContactCount || 0,
            attendees: [],
            assignMents: [],
            contactCount: 0,
          }));

        const previousAssignments = await this.checkPreviousAssignmentInBulk(
          newAttendees.map((a) => a.email),
          adminId,
          isAttended,
          empData.map((a) => a.id),
        );
        updateProgress(80);

        const empDataMap = new Map(empData.map((a) => [a.id.toString(), a]));

        newAttendees.forEach((attendee, index) => {
          if (previousAssignments.has(attendee.email)) {
            const prevAssign = previousAssignments.get(attendee.email);

            if (empDataMap.has(prevAssign.assignedTo.toString())) {
              const emp = empDataMap.get(prevAssign.assignedTo.toString());
              if (emp.contactCount < emp.contactLimit) {
                emp.attendees.push(attendee);
                emp.contactCount += 1;
                const newAssignment = {
                  adminId: new Types.ObjectId(`${adminId}`),
                  webinar: new Types.ObjectId(`${webinar}`),
                  attendee: attendee._id,
                  user: emp.id,
                  recordType: isAttended ? 'postWebinar' : 'preWebinar',
                };
                emp.assignMents.push(newAssignment);
                empDataMap.set(prevAssign.assignedTo.toString(), emp);
              }
            }
          }
        });

        // Use parallel processing
        await async.eachLimit(
          Array.from(empDataMap),
          5,
          async ([empId, empData]) => {
            const newAssignments =
              await this.assignService.createManyAssignments(
                empData.assignMents,
                currentSession,
              );

            const updatedAttendees = await this.attendeeModel.updateMany(
              { _id: { $in: empData.attendees.map((a) => a._id) } },
              {
                $set: {
                  assignedTo: new Types.ObjectId(`${empId}`),
                  status: null,
                },
              },
              { session: currentSession },
            );

            await this.attendeeLogService.createMultipleAssignmentsLog(
              empData,
              webinarName,
              new Types.ObjectId(`${adminId}`),
              currentSession,
              isAttended,
            );

            await this.userService.incrementCount(
              empId,
              empData.contactCount,
              currentSession,
            );
            if (
              newAssignments.length !== updatedAttendees.modifiedCount ||
              newAssignments.length !== empData.contactCount
            ) {
              throw new Error('Consistency check failed: mismatch in counts.');
            }

            if (empData.contactCount) {
              const notification = {
                // put it outside the session
                recipient: empId,
                title: 'New Tasks Assigned',
                message: `You have been assigned ${empData.contactCount} new tasks in the webinar: ${webinarName}. Please check your task list for details.`,
                type: notificationType.INFO,
                actionType: notificationActionType.ASSIGNMENT,
                metadata: {
                  webinarId: webinar,
                },
              };

              await this.notificationService.createNotification(notification);
            }
          },
        );
        updateProgress(90);
      });
      await this.subscriptionService.revalidateUsedContactCountsOfAdmin(
        new Types.ObjectId(`${adminId}`),
      );
      updateProgress(100);

      return {
        success: true,
        message: 'Attendee Import Completed',
        data: tempAttendees,
      };
    } catch (error) {
      console.log(error);
      throw new BadRequestException(
        error?.message || 'Attendee Import Failed. Please try again.',
      );
    } finally {
      session.endSession();
    }
  }

  async updateAttendeeTags(
    adminId: Types.ObjectId,
    webinarId: Types.ObjectId,
    emails: string[],
    tag: string,
  ) {
    const filter = {
      webinar: webinarId,
      adminId: adminId,
      email: {
        $in: emails,
      },
      isAttended: true,
    };

    const count = await this.attendeeModel.countDocuments(filter);

    if (emails.length !== count) {
      throw new BadRequestException(
        'Some or all of the specified attendees were not found for this webinar.',
      );
    }

    const updateResult = await this.attendeeModel.updateMany(filter, {
      $addToSet: { tags: tag.toLowerCase() },
    });

    return updateResult; // Returns an object like { matchedCount, modifiedCount, ... }
  }

  async hideAttendees(
    adminId: Types.ObjectId,
    webinarId: Types.ObjectId,
    attendees: string[],
  ) {
    const session = await this.attendeeModel.startSession();
    let DeletedAttendees = {};
    try {
      await session.withTransaction(async (currentSession) => {
        const attendeeData = await this.attendeeModel.find({
          adminId,
          webinar: webinarId,
          _id: { $in: attendees.map((a) => new Types.ObjectId(a)) },
        });

        const attendeeIds = attendeeData.map((a) => a._id as Types.ObjectId);
        const attendeeEmails = attendeeData.map((a) => a.email);
        DeletedAttendees = await this.attendeeModel.deleteMany(
          {
            adminId,
            webinar: webinarId,
            _id: { $in: attendees.map((a) => new Types.ObjectId(a)) },
          },
          { session: currentSession },
        );

        await this.alarmService.deleteAlarmsByAttendeeIds(
          currentSession,
          attendeeIds,
        );
        await this.assignService.deleteAssignmentsByWebinar(
          currentSession,
          adminId,
          webinarId,
          attendeeIds,
        );
        await this.enrollService.deleteEnrollmentsByWebinar(
          currentSession,
          adminId,
          webinarId,
          attendeeEmails,
        );
        await this.notesService.deleteNotesByAttendees(
          currentSession,
          attendeeIds,
        );

        const contactCount = await this.getNonUniqueAttendeesCount(
          [],
          adminId,
          currentSession,
        );

        await this.subscriptionService.updateContactCount(
          adminId,
          contactCount,
          currentSession,
        );
      });
    } catch (error) {
      console.error('Transaction failed during hideAttendees:', error);
      throw new BadRequestException(error.message);
    } finally {
      await session.endSession();
      console.log('Session ended.');
    }
  }

  async deleteAllAttendeeData(adminId: Types.ObjectId, attendees: string[]) {
    const session = await this.attendeeModel.startSession();
    let DeletedAttendees = {};
    try {
      await session.withTransaction(async (currentSession) => {
        const attendeeData = await this.attendeeModel.find({
          adminId,
          email: { $in: attendees },
        });

        if (attendeeData.length === 0) {
          throw new BadRequestException('No attendees found');
        }

        const attendeeIds: Types.ObjectId[] = attendeeData.map(
          (a) => a._id as Types.ObjectId,
        );

        DeletedAttendees = await this.attendeeModel.deleteMany(
          {
            adminId,
            email: { $in: attendees },
          },
          { session: currentSession },
        );

        await this.alarmService.deleteAlarmsByAttendeeIds(
          currentSession,
          attendeeIds,
        );
        await this.assignService.deleteAssignmentsByAttendeeIds(
          currentSession,
          adminId,
          attendeeIds,
        );
        await this.enrollService.deleteEnrollmentsByAttendeeIds(
          currentSession,
          adminId,
          attendees,
        );
        await this.attendeeAssociationService.deleteAttendeeAssociationsByAttendeeEmails(
          currentSession,
          adminId,
          attendees,
        );
        await this.notesService.deleteNotesByAttendees(
          currentSession,
          attendeeIds,
        );

        const contactCount = await this.getNonUniqueAttendeesCount(
          [],
          adminId,
          currentSession,
        );

        await this.subscriptionService.updateContactCount(
          adminId,
          contactCount,
          currentSession,
        );

        return DeletedAttendees;
      });
    } catch (error) {
      console.error(
        'Transaction failed during Delete All Attendees:',
        error.message,
      );
      throw new BadRequestException(error.message);
    } finally {
      await session.endSession();
      console.log('Session ended.');
    }
  }

  async getAttendee(adminId: string, email: string): Promise<any> {
    const pipeline: PipelineStage[] = [
      {
        $match: {
          email: email,
          adminId: new Types.ObjectId(adminId),
        },
      },
      {
        $lookup: {
          from: 'webinars', // The name of the collection to populate from
          localField: 'webinar', // The field from the Attendee model
          foreignField: '_id', // The field in the Webinar collection
          as: 'webinarDetails', // Alias to store populated webinar details
        },
      },
      {
        $lookup: {
          from: 'users', // The collection for admin and assignedTo (User model)
          localField: 'adminId', // The field from Attendee to match in User
          foreignField: '_id', // The field in the User collection
          as: 'adminDetails', // Alias to store populated admin details
        },
      },
      {
        $sort: {
          createdAt: -1, // Sort by createdAt in descending order
        },
      },
      {
        $addFields: {
          lookupField: {
            $ifNull: ['$tempAssignedTo', '$assignedTo'],
          },
        },
      },
      {
        $lookup: {
          from: 'users', // The collection for admin and assignedTo (User model)
          localField: 'lookupField', // The field from Attendee to match in User
          foreignField: '_id', // The field in the User collection
          as: 'lookedUpDetails', // Alias to store populated admin details
        },
      },
      {
        $project: {
          email: 1,
          attendeeHistory: {
            _id: '$_id',
            webinar: '$webinarDetails', // Webinar details from lookup
            admin: '$adminDetails', // Admin details from lookup
            phone: '$phone',
            gender: '$gender',
            firstName: '$firstName',
            lastName: '$lastName',
            leadType: '$leadType',
            timeInSession: '$timeInSession',
            assignedTo: '$assignedTo',
            isAttended: '$isAttended',
            createdAt: '$createdAt', // Include createdAt for sorting
            updatedAt: '$updatedAt', // Include updatedAt for reference
            tags: '$tags',
            location: '$location',
            assignedToUserName: {
              $ifNull: [
                {
                  $arrayElemAt: ['$lookedUpDetails.userName', 0],
                },
                '',
              ],
            },
          },
        },
      },
      {
        $group: {
          _id: '$email', // Group by email
          data: {
            $push: '$attendeeHistory', // Collect all the attendee history data
          },
        },
      },
    ];

    const aggregationResult = await this.attendeeModel
      .aggregate(pipeline)
      .exec();

    return aggregationResult;
  }

  async getAttendees(
    webinarId: string,
    AdminId: string,
    isAttended: boolean,
    page: number,
    limit: number,
    obj: {
      filters: AttendeesFilterDto;
      validCall?: string;
      assignmentType?: string;
      sort?: WebinarAttendeesSortObject;
      leadType?: boolean;
      fields?: string;
      emails?: string[];
    },
    usePagination: boolean = true,
  ): Promise<any> {
    const skip = (page - 1) * limit;

    const {
      filters,
      validCall,
      assignmentType,
      fields = '',
      sort = {
        sortBy: WebinarAttendeesSortBy.EMAIL,
        sortOrder: SortOrder.ASC,
      },
      emails,
    } = obj;

    const queryFields = fields.split(',').map((a) => a.trim());

    const allFields = {
      email: 1,
      firstName: 1,
      gender: 1,
      isAssigned: 1,
      isAttended: 1,
      lastName: 1,
      leadType: 1,
      location: 1,
      phone: 1,
      status: 1,
      timeInSession: 1,
      source: 1,
      createdAt: 1,
      tags: 1,
      enrollments: '$enrollments.labels',
      attendedCount: 1,
      registeredCount: 1,
    };

    const projectStage = {
      $project: {},
    };

    if (fields.length === 0) {
      projectStage.$project = allFields;
    } else {
      queryFields.forEach((field) => {
        if (field === 'enrollments') {
          projectStage.$project['enrollments'] = '$enrollments.labels';
        } else if (field === 'firstname') {
          projectStage.$project['firstName'] = 1;
        } else if (field === 'isassigned') {
          projectStage.$project['isAssigned'] = 1;
        } else if (field === 'isattended') {
          projectStage.$project['isAttended'] = 1;
        } else if (field === 'lastname') {
          projectStage.$project['lastName'] = 1;
        } else if (field === 'timeinsession') {
          projectStage.$project['timeInSession'] = 1;
        } else if (field === 'createdat') {
          projectStage.$project['createdAt'] = 1;
        } else if (field === 'attendedcount') {
          projectStage.$project['attendedCount'] = 1;
        } else if (field === 'registeredcount') {
          projectStage.$project['registeredCount'] = 1;
        } else {
          projectStage.$project[field] = 1;
        }
      });
    }

    const hasFilters = Object.keys(filters).some(
      (key) => filters[key] !== null && filters[key] !== undefined,
    );

    const timeInSessionFilter = {};
    if (filters.timeInSession) {
      if (filters.timeInSession.$gte) {
        if (!timeInSessionFilter['timeInSession'])
          timeInSessionFilter['timeInSession'] = {};

        timeInSessionFilter['timeInSession']['$gte'] = parseInt(
          `${filters.timeInSession.$gte}`,
          10,
        );
      }

      if (filters.timeInSession.$lte) {
        if (!timeInSessionFilter['timeInSession'])
          timeInSessionFilter['timeInSession'] = {};

        timeInSessionFilter['timeInSession']['$lte'] = parseInt(
          `${filters.timeInSession.$lte}`,
          10,
        );
      }
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
                    { $eq: ['$adminId', new Types.ObjectId(AdminId)] },
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

    const basePipeline: PipelineStage[] = [
      {
        $match: {
          adminId: new Types.ObjectId(AdminId),
          webinar: new Types.ObjectId(webinarId),
          isAttended: isAttended,
          isDeleted: { $ne: true },
          ...(validCall && {
            ...(validCall === 'Worked'
              ? { status: { $ne: null } }
              : { status: null }),
          }),
          ...(assignmentType && {
            ...(assignmentType === 'Assigned'
              ? {
                  $and: [
                    { assignedTo: { $ne: null } },
                    { isPulledback: { $ne: true } },
                  ],
                }
              : { assignedTo: null }),
          }),
          ...(emails && Array.isArray(emails) && emails.length > 0 && {
            email: { $in: emails },
          }),
        },
      },

      ...(Array.isArray(filters.isAssigned) && filters.isAssigned.length > 0
        ? [
            {
              $addFields: {
                lookupField: { $ifNull: ['$tempAssignedTo', '$assignedTo'] },
              },
            },
          ]
        : []),

      ...(hasFilters
        ? [
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
                //// Assume 'filters' is an object containing your filter criteria
                // Assume 'queryObject' is what you'll pass to Model.find()

                // const queryObject = { user: userId }; // Example base query

                // // ... other filter conditions ...

                // if (filters.location && typeof filters.location === 'string' && filters.location.trim() !== '') {
                //     const locationsArray = filters.location
                //         .split(',')
                //         .map(loc => loc.trim()) // Trim whitespace from each location
                //         .filter(loc => loc.length > 0); // Remove any empty strings if there were,, or trailing,

                //     if (locationsArray.length > 0) {
                //         // Function to escape special characters for regex
                //         const escapeRegex = (string) => {
                //             return string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                //         };

                //         // Create a regex pattern like "escapedLoc1|escapedLoc2|escapedLoc3"
                //         const regexPattern = locationsArray
                //             .map(loc => escapeRegex(loc)) // Escape each location term
                //             .join('|');                  // Join with OR operator

                //         // Now, use this pattern in your query
                //         // This will match if the 'location' field contains any of the provided locations.
                //         // For example, if regexPattern is "New York|London", it will match:
                //         // - "Office in New York"
                //         // - "London HQ"
                //         // - "New York and London"
                //         queryObject.location = { $regex: regexPattern, $options: 'i' };
                //     }
                // }

                // ...
                // const results = await YourModel.find(queryObject);
                // ...
                ...(filters.source && {
                  source: { $regex: filters.source, $options: 'i' },
                }),
                ...(filters.timeInSession && timeInSessionFilter),
                ...(filters.status && {
                  status: { $in: filters.status },
                }),
                ...(filters.tags && {
                  tags: { $in: filters.tags },
                }),
                ...(Array.isArray(filters.isAssigned) &&
                  filters.isAssigned.length > 0 && {
                    lookupField: {
                      $in: filters.isAssigned.map(
                        (item) => new Types.ObjectId(item),
                      ),
                    },
                  }),
              },
            },
          ]
        : []),

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
                            $eq: ['$adminId', new Types.ObjectId(`${AdminId}`)],
                          },
                          { $eq: ['$email', '$$tempMail'] },
                          {
                            $in: [
                              '$leadType',
                              filters.leadType.map(
                                (item) => new Types.ObjectId(item),
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

      ...(filters?.enrollments?.length
        ? [
            {
              $lookup: {
                from: 'enrollments',
                let: { tempMail: '$email' },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          {
                            $eq: ['$attendee', '$$tempMail'],
                          },
                          {
                            $eq: ['$adminId', new Types.ObjectId(`${AdminId}`)],
                          },
                        ],
                      },
                    },
                  },
                  {
                    $group: {
                      _id: {
                        product: '$product',
                        price: '$price',
                      },
                      count: {
                        $sum: 1,
                      },
                    },
                  },
                  {
                    $lookup: {
                      from: 'products',
                      localField: '_id.product',
                      foreignField: '_id',
                      as: 'product',
                    },
                  },
                  {
                    $unwind: {
                      path: '$product',
                      preserveNullAndEmptyArrays: true,
                    },
                  },
                  {
                    $addFields: {
                      label: {
                        $concat: [
                          '$product.name',
                          ' (',
                          { $toString: '$count' },
                          ') - ',
                          { $toString: '$_id.price' },
                        ],
                      },
                    },
                  },
                  {
                    $group: {
                      _id: null,
                      labels: { $push: '$label' },
                      ids: { $push: '$_id.product' },
                    },
                  },
                ],
                as: 'enrollments',
              },
            },
            {
              $unwind: {
                path: '$enrollments',
                preserveNullAndEmptyArrays: false,
              },
            },
            {
              $match: {
                'enrollments.ids': {
                  $in: filters.enrollments.map((id) => new Types.ObjectId(id)),
                },
              },
            },
          ]
        : []),

      // ADD THE COUNT CALCULATION STAGES
      ...attendanceCountStages,

      // ADD THE FILTERING STAGE FOR THE NEWLY CALCULATED COUNTS
      // This stage is only added if a filter for it exists.
      ...(Object.keys(attendanceCountFilter).length > 0
        ? [{ $match: attendanceCountFilter }]
        : []),
    ];

    const pipeline: PipelineStage[] = [
      ...basePipeline,
      { $sort: { [sort.sortBy]: sort.sortOrder === SortOrder.ASC ? 1 : -1 } },
      { $skip: skip },
      ...(limit > 0 ? [{ $limit: limit }] : []),
      ...(filters.isAssigned
        ? []
        : [
            {
              $addFields: {
                lookupField: { $ifNull: ['$tempAssignedTo', '$assignedTo'] },
              },
            },
          ]),
      {
        $lookup: {
          from: 'users',
          localField: 'lookupField',
          foreignField: '_id',
          as: 'assignedToDetails',
        },
      },
      {
        $project: {
          lookupField: 0,
        },
      },
      ...(Array.isArray(filters.leadType) && filters.leadType.length > 0
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
                            $eq: ['$adminId', new Types.ObjectId(`${AdminId}`)],
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
          isAssigned: {
            $arrayElemAt: ['$assignedToDetails.userName', 0],
          },
          leadType: '$attendeeAssociations.leadType',
        },
      },
      ...(filters?.enrollments?.length
        ? []
        : [
            {
              $lookup: {
                from: 'enrollments',
                let: { tempMail: '$email' },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          {
                            $eq: ['$adminId', new Types.ObjectId(`${AdminId}`)],
                          },
                          {
                            $eq: ['$attendee', '$$tempMail'],
                          },
                        ],
                      },
                    },
                  },
                  {
                    $group: {
                      _id: {
                        product: '$product',
                        price: '$price',
                      },
                      count: {
                        $sum: 1,
                      },
                    },
                  },
                  {
                    $lookup: {
                      from: 'products',
                      localField: '_id.product',
                      foreignField: '_id',
                      as: 'product',
                    },
                  },
                  {
                    $unwind: {
                      path: '$product',
                      preserveNullAndEmptyArrays: true,
                    },
                  },
                  {
                    $addFields: {
                      label: {
                        $concat: [
                          '$product.name',
                          ' (',
                          { $toString: '$count' },
                          ') - ',
                          { $toString: '$_id.price' },
                        ],
                      },
                    },
                  },
                  {
                    $group: {
                      _id: null,
                      labels: { $push: '$label' },
                    },
                  },
                  {
                    $project: {
                      _id: 0,
                      labels: 1,
                    },
                  },
                ],
                as: 'enrollments',
              },
            },
            {
              $unwind: {
                path: '$enrollments',
                preserveNullAndEmptyArrays: true,
              },
            },
          ]),
      projectStage,
    ];

    if (usePagination) {
      const [result, totalResult] = await Promise.all([
        this.attendeeModel.aggregate(pipeline).exec(),
        this.attendeeModel
          .aggregate([...basePipeline, { $count: 'total' }])
          .exec(),
      ]);
      const total = totalResult[0]?.total || 0;

      if (obj.leadType) {
        const leadTypes =
          await this.customLeadTypeService.getLeadTypes(AdminId);
        if (Array.isArray(leadTypes) && leadTypes.length > 0) {
          const leadTypeMap = new Map();
          leadTypes.forEach((lead) => {
            leadTypeMap.set(lead._id.toString(), lead.label);
          });

          result.forEach((attendee) => {
            if (
              attendee.leadType &&
              leadTypeMap.has(attendee.leadType.toString())
            ) {
              attendee.leadType = leadTypeMap.get(attendee.leadType.toString());
            }
          });
        }
      }

      const webinar = await this.webinarService.getWebinarById(webinarId);

      const webinarName = webinar?.webinarName || 'Webinar';

      const pagination = {
        total,
        totalPages: Math.ceil(total / limit),
        page,
        limit,
      };

      return {
        pagination,
        result,
        webinarName,
      };
    } else {
      return this.attendeeModel
        .aggregate([
          ...pipeline,
          {
            $lookup: {
              from: 'attendees',
              let: { tempMail: '$email' },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        {
                          $eq: ['$adminId', new Types.ObjectId(`${AdminId}`)],
                        },
                        { $eq: ['$email', '$$tempMail'] },
                        { $ne: ['$phone', null] },
                        { $ne: ['$phone', ''] },
                      ],
                    },
                  },
                },
                {
                  $group: {
                    _id: '$phone',
                  },
                },
              ],
              as: 'phoneDetails',
            },
          },
        ])
        .exec();
    }
  }

  async swapFields(payload: SwapAttendeeFieldsDTO, adminId: string) {
    const {
      attendees: attendeesIds,
      field1,
      field2,
      filters,
      webinarId,
      isAttended,
      validCall,
      assignmentType,
    } = payload;

    if (!field1 || !field2) {
      throw new BadRequestException('Both field1 and field2 must be provided.');
    }

    const webinar = await this.webinarService.getWebinar(webinarId, adminId);

    if (!webinar) {
      throw new BadRequestException('Webinar Not Exists.');
    }

    let attendees = [];

    if (attendeesIds.length > 0) {
      attendees = await this.attendeeModel
        .find({
          _id: { $in: attendeesIds },
          adminId: new Types.ObjectId(`${adminId}`),
        })
        .exec();
    } else {
      const result = await this.getAttendees(
        webinarId,
        adminId,
        isAttended,
        1,
        0,
        {
          filters,
          validCall,
          assignmentType,
        },
      );
      attendees = result.result;
    }

    if (attendeesIds.length > 0 && attendees.length !== attendeesIds.length) {
      throw new BadRequestException('Some attendees were not found.');
    }

    if (attendees.length === 0) {
      throw new BadRequestException('No attendees found to update');
    }

    const bulkOps = attendees.map((attendee) => ({
      updateOne: {
        filter: { _id: attendee._id },
        update: {
          $set: {
            [field1]: attendee[field2],
            [field2]: attendee[field1],
          },
        },
      },
    }));

    const result = await this.attendeeModel.bulkWrite(bulkOps);

    if (result.modifiedCount !== attendees.length) {
      throw new InternalServerErrorException(
        `Only ${result.modifiedCount} out of ${attendees.length} attendees were updated`,
      );
    }

    const webinarName = webinar.webinarName;
    const webinarType = isAttended ? 'Sales' : 'Reminder';

    const attendeeLogs = attendees.map((attendee) => ({
      attendee: attendee.email,
      action: AttendeeAction.COlUMN_SWAP, // or whatever action you want
      item: webinarName,
      details: `<span>Swapped <strong>${field1}</strong> and <strong>${field2}</strong> in the <strong>${webinarType}</strong> webinar: <strong>${webinarName}</strong></span>`,
      adminId: new Types.ObjectId(adminId),
    }));

    // ✅ Save the logs
    await this.attendeeLogService.createAttendeeLogs(attendeeLogs);

    return { message: 'Attendees updated successfully', success: true };
  }

  async getPostWebinarAttendee(webinarId: string, adminId?: string) {
    const result = await this.attendeeModel.findOne({
      webinar: new Types.ObjectId(`${webinarId}`),
      ...(mongoose.isValidObjectId(adminId) ? { adminId: new Types.ObjectId(`${adminId}`) } : {}),
      isAttended: true,
    });

    return result;
  }

  async updateAttendee(
    id: string,
    adminId: string, // Consider if adminId is truly needed here for permission check vs update filter
    userId: string, // The user performing the action
    updateAttendeeDto: UpdateAttendeeDto,
    attendeeLogFlag: boolean = true,
  ): Promise<Attendee> {
    // 1. Fetch the attendee *before* the update for permission check and comparison
    const attendeeBeforeUpdate = await this.attendeeModel.findOne({
      _id: new Types.ObjectId(id), // Use new without backticks for string id
    });

    if (!attendeeBeforeUpdate) {
      throw new NotFoundException('Attendee not found.');
    }
    console.log(attendeeBeforeUpdate , userId);

    // Permission check: Allow if userId is the assignedTo, tempAssignedTo, or adminId of the *existing* attendee
    if (
      String(userId) !== String(attendeeBeforeUpdate.assignedTo) &&
      String(userId) !== String(attendeeBeforeUpdate.tempAssignedTo) &&
      String(userId) !== String(attendeeBeforeUpdate.adminId)
    ) {
      throw new UnauthorizedException(
        'Only Admin or assigned Employee is allowed to update attendee data.',
      );
    }

    // Example with adminId filter:
    const resultWithAdminFilter = await this.attendeeModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(id),
        // This assumes the 'adminId' field on the Attendee document MUST match the 'adminId' passed into the function.
        // This is a valid approach if attendees are strictly scoped under an admin.
        adminId: new Types.ObjectId(adminId),
      },
      updateAttendeeDto,
      { new: true },
    );

    if (!resultWithAdminFilter) {
      // This could happen if the initial findOne was successful but the findOneAndUpdate filter (like adminId) failed,
      // or if the document was deleted concurrently.
      throw new NotFoundException(
        'No record found or authorized to be updated.',
      );
    }

    if (attendeeLogFlag) {
      // 3. Build the detailed log message
      let logDetails = `<span>Attendee Updated`;
      const changes: string[] = [];

      // Iterate through the fields provided in the update DTO
      // and compare the 'before' and 'after' values
      for (const key in updateAttendeeDto) {
        // Check if the key exists in the DTO and the original document (or could potentially exist)
        // We only log changes for fields present in the DTO
        if (updateAttendeeDto.hasOwnProperty(key)) {
          const oldValue = attendeeBeforeUpdate[key];
          const newValue = resultWithAdminFilter[key]; // Use the result document

          // Compare values. Handle ObjectIds and potential null/undefined values carefully.
          // Converting to String() is a simple way to compare many types for logging purposes.
          const oldValueString =
            oldValue === null || oldValue === undefined
              ? 'N/A'
              : oldValue instanceof Types.ObjectId
                ? oldValue.toString()
                : String(oldValue);
          const newValueString =
            newValue === null || newValue === undefined
              ? 'N/A'
              : newValue instanceof Types.ObjectId
                ? newValue.toString()
                : String(newValue);

          if (oldValueString !== newValueString) {
            // Log the change only if the string representation is different
            changes.push(
              `"${key}" from "${oldValueString}" to "${newValueString}"`,
            );
          }
        }
      }

      // Add context from DTO and the detected changes to the log details
      const updatedBy = updateAttendeeDto.createdBy || 'N/A';
      const webinarName = updateAttendeeDto.webinarName || 'N/A';

      if (changes.length > 0) {
        logDetails += ` by <strong>${updatedBy}</strong> from the webinar : <strong>${webinarName}</strong>. Changes: <strong>${changes.join(', ')}</strong>.</span>`;
      } else {
        // If no actual changes were detected (e.g., DTO had same values as current)
        logDetails += ` by <strong>${updatedBy}</strong> from the webinar : <strong>${webinarName}</strong>. No actual changes detected.</span>`;
      }

      // 4. Create the log entry
      // Check if adminId is available as it's required by createSingleAttendeeLog
      if (adminId) {
        this.attendeeLogService.createSingleAttendeeLog({
          // Use email from the updated document
          attendee: resultWithAdminFilter.email,
          item: '', // As per original code
          action: AttendeeAction.UPDATE_ATTENDEE,
          details: logDetails,
          adminId: new Types.ObjectId(adminId),
        });
      } else {
        // Optional: Log a warning or error if adminId is missing but logging was intended
        console.warn('AdminId is missing, skipping attendee log creation.');
      }
    }

    // 5. Return the updated document
    return resultWithAdminFilter;
  }

  async updateAttendeeAssign(
    id: string,
    assignedTo: string,
    isTemporary: boolean = false,
  ): Promise<Attendee | null> {
    return await this.attendeeModel.findByIdAndUpdate(
      id,
      {
        $set: {
          ...(isTemporary
            ? {
                tempAssignedTo: Types.ObjectId.isValid(assignedTo)
                  ? new Types.ObjectId(assignedTo)
                  : null,
              }
            : {
                assignedTo: Types.ObjectId.isValid(assignedTo)
                  ? new Types.ObjectId(assignedTo)
                  : null,
              }),
          status: null,
        },
      },
      { new: true },
    );
  }

  async deleteAttendeesByWebinar(
    session: ClientSession,
    webinarId: Types.ObjectId,
    adminId: Types.ObjectId,
  ): Promise<DeleteResult> {
    const filter = {
      adminId: adminId,
      webinar: webinarId,
    };

    return this.attendeeModel.deleteMany(filter).session(session).exec();
  }

  async checkPreviousAssignment(email: string): Promise<Attendee | null> {
    const lastAssigned = await this.attendeeModel
      .findOne({
        email,
        isAttended: false,
        assignedTo: {
          $ne: null,
        },
      })
      .sort({ createdAt: -1 })
      .exec();

    return lastAssigned;
  }

  async checkPreviousAssignmentInBulk(
    emails: string[],
    adminId: string,
    isAttended: boolean,
    empIds: Types.ObjectId[],
  ): Promise<
    Map<
      string,
      {
        _id: string;
        assignedTo: Types.ObjectId;
      }
    >
  > {
    if (emails.length === 0 || empIds.length === 0) return new Map();

    const pipeline: PipelineStage[] = [
      {
        $match: {
          adminId: new Types.ObjectId(`${adminId}`),
          assignedTo: { $ne: null },
          isAttended: isAttended,
        },
      },
      {
        $sort: { createdAt: -1 },
      },
      {
        $group: {
          _id: '$email',
          firstDetail: { $first: '$$ROOT' },
        },
      },
      {
        $addFields: {
          assignedTo: '$firstDetail.assignedTo',
        },
      },
      {
        $project: {
          firstDetail: 0,
        },
      },
      {
        $match: {
          assignedTo: { $in: empIds },
        },
      },
    ];

    const lastAssigned: {
      _id: string;
      assignedTo: Types.ObjectId;
    }[] = await this.attendeeModel.aggregate(pipeline).exec();

    const lastAssignMap = new Map();
    lastAssigned.forEach((attendee) => {
      lastAssignMap.set(attendee._id, attendee);
    });

    const result = new Map();
    emails.forEach((email) => {
      if (lastAssignMap.has(email)) {
        const attendee = lastAssignMap.get(email);
        result.set(email, attendee);
      }
    });

    return result;
  }

  async getNonUniqueAttendeesCount(
    emails: string[],
    adminId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<number> {
    const pipiline: PipelineStage[] = [
      {
        $match: {
          adminId: adminId,
        },
      },
      ...(emails.length > 0
        ? [
            {
              $match: {
                email: { $in: emails },
              },
            },
          ]
        : []),
      {
        $group: {
          _id: '$email',
        },
      },
      {
        $count: 'emailCount',
      },
    ];

    const aggregation = this.attendeeModel.aggregate(pipiline);

    if (session) {
      aggregation.session(session);
    }

    const result = await aggregation.exec();

    if (Array.isArray(result) && result.length > 0) {
      return result[0]?.emailCount || 0;
    }
    return 0;
  }

  async getDynamicAttendeeCount(adminId: Types.ObjectId) {
    const pipiline: PipelineStage[] = [
      { $match: { adminId } },
      { $group: { _id: '$email' } },
      { $count: 'emailCount' },
    ];
    const result = await this.attendeeModel.aggregate(pipiline);
    if (Array.isArray(result) && result.length > 0) {
      return result[0]?.emailCount || 0;
    }
    return 0;
  }

  async getPreWebinarUnattendedData(
    adminId: Types.ObjectId,
    webinarId: Types.ObjectId,
    emails: string[],
  ) {
    const result = await this.attendeeModel.find({
      adminId,
      webinar: webinarId,
      email: { $nin: emails },
      isAttended: false,
    });
    return result.map((attendee) => ({
      email: attendee.email,
      firstName: attendee.firstName,
      lastName: attendee.lastName,
      phone: attendee.phone,
      timeInSession: 0,
      gender: attendee.gender,
      location: attendee.location,
      webinar: attendee.webinar,
      isAttended: true,
      adminId: attendee.adminId,
    }));
  }

  async getAttendeePhoneNumbers(
    adminId: Types.ObjectId,
    emails: string[] | string,
  ): Promise<{ _id: string; phone: string }[]> {
    const pipeline: PipelineStage[] = [
      {
        $match: {
          adminId,
          email: typeof emails === 'string' ? emails : { $in: emails },
          $and: [{ phone: { $exists: true } }, { phone: { $ne: '' } }],
        },
      },
      {
        $group: {
          _id: '$email',
          phone: {
            $first: '$phone',
          },
        },
      },
    ];
    return await this.attendeeModel.aggregate(pipeline).exec();
  }

  async fetchGroupedAttendees(
    adminId: Types.ObjectId,
    page: number = 1,
    limit: number = 10,
    filters: GroupedAttendeesFilterDto = {},
    sort: GroupedAttendeesSortObject = {
      sortBy: GroupedAttendeesSortBy.EMAIL,
      sortOrder: SortOrder.ASC,
    },
  ) {
    const isLastFilters =
      this.checkLength(filters.salesAssignedTo) ||
      this.checkLength(filters.salesLastStatus) ||
      this.checkLength(filters.reminderAssignedTo) ||
      this.checkLength(filters.reminderLastStatus) ||
      this.checkLength(filters.tags);

    const parseNum = (val) => {
      if (typeof val === 'number') return val;
      if (typeof val === 'string' && parseInt(val, 10) >= 0) {
        return parseInt(val, 10);
      }
      return null;
    };

    const timeInSessionFilter = {};
    const timeInSession = filters.timeInSession;

    if (timeInSession) {
      timeInSessionFilter['timeInSession'] = {};

      if (timeInSession.$gte !== undefined) {
        const gteValue = parseNum(timeInSession.$gte);
        if (gteValue !== null) {
          timeInSessionFilter['timeInSession'].$gte = gteValue;
        }
      }

      if (timeInSession.$lte !== undefined) {
        const lteValue = parseNum(timeInSession.$lte);
        if (lteValue !== null) {
          timeInSessionFilter['timeInSession'].$lte = lteValue;
        }
      }
    }

    const attendedWebinarCountFilter = {};
    const attendedWebinarCount = filters.attendedWebinarCount;

    if (attendedWebinarCount) {
      attendedWebinarCountFilter['attendedWebinarCount'] = {};

      if (attendedWebinarCount.$gte !== undefined) {
        const gteValue = parseNum(attendedWebinarCount.$gte);
        if (gteValue !== null) {
          attendedWebinarCountFilter['attendedWebinarCount'].$gte = gteValue;
        }
      }

      if (attendedWebinarCount.$lte !== undefined) {
        const lteValue = parseNum(attendedWebinarCount.$lte);
        if (lteValue !== null) {
          attendedWebinarCountFilter['attendedWebinarCount'].$lte = lteValue;
        }
      }
    }

    const registeredWebinarCountFilter = {};
    const registeredWebinarCount = filters.registeredWebinarCount;

    if (registeredWebinarCount) {
      registeredWebinarCountFilter['registeredWebinarCount'] = {};

      if (registeredWebinarCount.$gte !== undefined) {
        const gteValue = parseNum(registeredWebinarCount.$gte);
        if (gteValue !== null) {
          registeredWebinarCountFilter['registeredWebinarCount'].$gte =
            gteValue;
        }
      }

      if (registeredWebinarCount.$lte !== undefined) {
        const lteValue = parseNum(registeredWebinarCount.$lte);
        if (lteValue !== null) {
          registeredWebinarCountFilter['registeredWebinarCount'].$lte =
            lteValue;
        }
      }
    }

    const skip = (page - 1) * limit;
    const basePipeline: PipelineStage[] = [
      {
        $match: {
          adminId,
          ...(filters.email && {
            email: { $regex: filters.email },
          }),
          ...(filters.emails && Array.isArray(filters.emails) && filters.emails.length > 0 && {
            email: { $in: filters.emails },
          }),
        },
      },
      {
        $sort: {
          createdAt: -1,
        },
      },
      {
        $group: {
          _id: '$email',
          salesAssignedToList: {
            $push: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$isAttended', true] },
                    { $ne: ['$assignedTo', null] },
                  ],
                },
                '$assignedTo',
                '$$REMOVE',
              ],
            },
          },
          salesLastStatusList: {
            $push: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$isAttended', true] },
                    { $ne: ['$status', null] },
                  ],
                },
                '$status',
                '$$REMOVE',
              ],
            },
          },
          reminderAssignedToList: {
            $push: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$isAttended', false] },
                    { $ne: ['$assignedTo', null] },
                  ],
                },
                '$assignedTo',
                '$$REMOVE',
              ],
            },
          },
          reminderLastStatusList: {
            $push: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$isAttended', false] },
                    { $ne: ['$status', null] },
                  ],
                },
                '$status',
                '$$REMOVE',
              ],
            },
          },
          tagsList: {
            $push: {
              $cond: [
                { $gt: [{ $size: '$tags' }, 0] }, // Only if tags array has items
                '$tags',
                '$$REMOVE', // Skip empty arrays
              ],
            },
          },
          adminId: {
            $first: '$adminId',
          },
          timeInSession: {
            $sum: '$timeInSession',
          },
          attendeeId: {
            $first: '$_id',
          },
          registeredWebinarCount: {
            $sum: {
              $cond: [{ $eq: ['$isAttended', false] }, 1, 0],
            },
          },
          attendedWebinarCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$isAttended', true] },
                    { $gt: ['$timeInSession', 0] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          locations: {
            $addToSet: '$location',
          },
          sources: {
            $addToSet: '$source',
          },
          phones: {
            $addToSet: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$phone', null] },
                    { $ne: ['$phone', ''] },
                  ],
                },
                '$phone',
                '$$REMOVE',
              ],
            },
          },
          fullNames: {
            $addToSet: {
              $trim: {
                input: {
                  $concat: [
                    { $ifNull: ['$firstName', ''] },
                    ' ',
                    { $ifNull: ['$lastName', ''] },
                  ],
                },
              },
            },
          },
        },
      },

      {
        $match: {
          ...timeInSessionFilter,
          ...attendedWebinarCountFilter,
          ...registeredWebinarCountFilter,
          ...(Array.isArray(filters.locations) &&
            filters.locations.length > 0 && {
              locations: {
                $in: filters.locations.map((a) => a.toLowerCase()),
              },
            }),

          ...(Array.isArray(filters.sources) &&
            filters.sources.length > 0 && {
              sources: {
                $in: filters.sources.map((a) => a.toLowerCase()),
              },
            }),
        },
      },

      ...(this.checkLength(filters.leadType)
        ? [
            {
              $lookup: {
                from: 'attendeeassociations',
                let: { tempMail: '$_id' },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $eq: ['$adminId', adminId] },
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

                as: 'lead',
              },
            },
            {
              $unwind: {
                path: '$lead',
                preserveNullAndEmptyArrays: false,
              },
            },
          ]
        : []),

      ...(isLastFilters
        ? [
            {
              $addFields: {
                tags: {
                  $reduce: {
                    input: '$tagsList',
                    initialValue: [],
                    in: { $setUnion: ['$$value', '$$this'] },
                  },
                },
                salesAssignedTo: {
                  $first: '$salesAssignedToList',
                },
                salesLastStatus: {
                  $first: '$salesLastStatusList',
                },
                reminderAssignedTo: {
                  $first: '$reminderAssignedToList',
                },
                reminderLastStatus: {
                  $first: '$reminderLastStatusList',
                },
              },
            },
            {
              $match: {
                ...(this.checkLength(filters.salesAssignedTo) && {
                  salesAssignedTo: {
                    $in: filters.salesAssignedTo.map(
                      (a) => new Types.ObjectId(a),
                    ),
                  },
                }),
                ...(this.checkLength(filters.salesLastStatus) && {
                  salesLastStatus: {
                    $in: filters.salesLastStatus,
                  },
                }),
                ...(this.checkLength(filters.reminderAssignedTo) && {
                  reminderAssignedTo: {
                    $in: filters.reminderAssignedTo.map(
                      (a) => new Types.ObjectId(a),
                    ),
                  },
                }),
                ...(this.checkLength(filters.reminderLastStatus) && {
                  reminderLastStatus: {
                    $in: filters.reminderLastStatus,
                  },
                }),

                ...(this.checkLength(filters.tags) && {
                  $expr: {
                    $gt: [
                      {
                        $size: { $setIntersection: ['$tags', filters.tags] },
                      },
                      0,
                    ],
                  },
                }),
              },
            },
          ]
        : []),

      ...(filters?.enrollments?.length
        ? [
            {
              $lookup: {
                from: 'enrollments',
                let: {
                  tempMail: '$_id',
                  tempAdminId: new Types.ObjectId(`${adminId}`),
                },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          {
                            $eq: ['$attendee', '$$tempMail'],
                          },
                          {
                            $eq: ['$adminId', '$$tempAdminId'],
                          },
                        ],
                      },
                    },
                  },
                  {
                    $group: {
                      _id: {
                        product: '$product',
                        price: '$price',
                      },
                      count: {
                        $sum: 1,
                      },
                    },
                  },
                  {
                    $lookup: {
                      from: 'products',
                      localField: '_id.product',
                      foreignField: '_id',
                      as: 'product',
                    },
                  },
                  {
                    $unwind: {
                      path: '$product',
                      preserveNullAndEmptyArrays: true,
                    },
                  },
                  {
                    $addFields: {
                      label: {
                        $concat: [
                          '$product.name',
                          ' (',
                          { $toString: '$count' },
                          ') - ',
                          { $toString: '$_id.price' },
                        ],
                      },
                    },
                  },
                  {
                    $group: {
                      _id: null,
                      labels: { $push: '$label' },
                      ids: { $push: '$_id.product' },
                    },
                  },
                ],
                as: 'enrollments',
              },
            },
            {
              $unwind: {
                path: '$enrollments',
                preserveNullAndEmptyArrays: false,
              },
            },
            {
              $match: {
                'enrollments.ids': {
                  $in: filters.enrollments.map((id) => new Types.ObjectId(id)),
                },
              },
            },
          ]
        : []),
    ];

    const countPipeline: PipelineStage[] = [
      ...basePipeline,
      { $count: 'total' },
    ];

    const mainPipeline: PipelineStage[] = [
      ...basePipeline,
      {
        $sort: {
          [sort.sortBy]: sort.sortOrder === SortOrder.ASC ? 1 : -1,
        },
      },
      { $skip: skip },
      ...(limit ? [{ $limit: limit }] : []),
      ...(filters.leadType
        ? []
        : [
            {
              $lookup: {
                from: 'attendeeassociations',
                let: { tempMail: '$_id' },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $eq: ['$adminId', adminId] },
                          { $eq: ['$email', '$$tempMail'] }, // Match email with attendee email
                        ],
                      },
                    },
                  },
                ],

                as: 'lead',
              },
            },
            {
              $unwind: {
                path: '$lead',
                preserveNullAndEmptyArrays: true,
              },
            },
          ]),
      ...(!isLastFilters
        ? [
            {
              $addFields: {
                tags: {
                  $reduce: {
                    input: '$tagsList',
                    initialValue: [],
                    in: { $setUnion: ['$$value', '$$this'] },
                  },
                },
                salesAssignedTo: {
                  $first: '$salesAssignedToList',
                },
                salesLastStatus: {
                  $first: '$salesLastStatusList',
                },
                reminderAssignedTo: {
                  $first: '$reminderAssignedToList',
                },
                reminderLastStatus: {
                  $first: '$reminderLastStatusList',
                },
              },
            },
          ]
        : []),

      ...(filters?.enrollments?.length
        ? []
        : [
            {
              $lookup: {
                from: 'enrollments',
                let: { tempMail: '$_id' },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          {
                            $eq: ['$attendee', '$$tempMail'],
                          },
                          {
                            $eq: ['$adminId', new Types.ObjectId(`${adminId}`)],
                          },
                        ],
                      },
                    },
                  },
                  {
                    $group: {
                      _id: {
                        product: '$product',
                        price: '$price',
                      },
                      count: {
                        $sum: 1,
                      },
                    },
                  },
                  {
                    $lookup: {
                      from: 'products',
                      localField: '_id.product',
                      foreignField: '_id',
                      as: 'product',
                    },
                  },
                  {
                    $unwind: {
                      path: '$product',
                      preserveNullAndEmptyArrays: true,
                    },
                  },
                  {
                    $addFields: {
                      label: {
                        $concat: [
                          '$product.name',
                          ' (',
                          { $toString: '$count' },
                          ') - ',
                          { $toString: '$_id.price' },
                        ],
                      },
                    },
                  },
                  {
                    $group: {
                      _id: null,
                      labels: { $push: '$label' },
                    },
                  },
                  {
                    $project: {
                      _id: 0,
                      labels: 1,
                    },
                  },
                ],
                as: 'enrollments',
              },
            },
            {
              $unwind: {
                path: '$enrollments',
                preserveNullAndEmptyArrays: true,
              },
            },
          ]),
      {
        $project: {
          reminderLastStatus: 1,
          enrollments: '$enrollments.labels',
          salesLastStatus: 1,
          reminderAssignedTo: 1,
          salesAssignedTo: 1,
          tags: 1,
          leadType: '$lead.leadType',
          adminId: 1,
          timeInSession: 1,
          attendeeId: 1,
          attendedWebinarCount: 1,
          registeredWebinarCount: 1,
          locations: 1,
          sources: 1,
          phones: 1,
          fullNames: {
            $filter: {
              input: '$fullNames',
              as: 'name',
              cond: { $ne: ['$$name', ''] },
            },
          },
        },
      },
    ];

    const [countResult, mainResult] = await Promise.all([
      this.attendeeModel.aggregate(countPipeline).exec(),
      this.attendeeModel.aggregate(mainPipeline).exec(),
    ]);
    const total = countResult[0]?.total || 0;
    const totalPages = limit ? Math.ceil(total / limit) || 1 : 1;
    const pagination = { page, totalPages, total };
    return { data: mainResult || [], pagination };
  }

  async fetchGroupedAttendeesForExport(
    adminId: Types.ObjectId,
    page: number = 1,
    limit: number = 10,
    filters: GroupedAttendeesFilterDto = {},
    sort: GroupedAttendeesSortObject = {
      sortBy: GroupedAttendeesSortBy.EMAIL,
      sortOrder: SortOrder.ASC,
    },
  ) {
    const isLastFilters =
      this.checkLength(filters.salesAssignedTo) ||
      this.checkLength(filters.salesLastStatus) ||
      this.checkLength(filters.reminderAssignedTo) ||
      this.checkLength(filters.reminderLastStatus) ||
      this.checkLength(filters.tags);

    const skip = (page - 1) * limit;
    const basePipeline: PipelineStage[] = [
      {
        $match: {
          adminId,
          ...(filters.email && {
            email: { $regex: filters.email },
          }),
        },
      },
      {
        $sort: {
          createdAt: -1,
        },
      },
      {
        $group: {
          _id: '$email',
          salesAssignedToList: {
            $push: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$isAttended', true] },
                    { $ne: ['$assignedTo', null] },
                  ],
                },
                '$assignedTo',
                '$$REMOVE',
              ],
            },
          },
          salesLastStatusList: {
            $push: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$isAttended', true] },
                    { $ne: ['$status', null] },
                  ],
                },
                '$status',
                '$$REMOVE',
              ],
            },
          },
          reminderAssignedToList: {
            $push: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$isAttended', false] },
                    { $ne: ['$assignedTo', null] },
                  ],
                },
                '$assignedTo',
                '$$REMOVE',
              ],
            },
          },
          reminderLastStatusList: {
            $push: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$isAttended', false] },
                    { $ne: ['$status', null] },
                  ],
                },
                '$status',
                '$$REMOVE',
              ],
            },
          },
          tagsList: {
            $push: {
              $cond: [
                { $gt: [{ $size: '$tags' }, 0] }, // Only if tags array has items
                '$tags',
                '$$REMOVE', // Skip empty arrays
              ],
            },
          },
          adminId: {
            $first: '$adminId',
          },
          timeInSession: {
            $sum: '$timeInSession',
          },
          attendeeId: {
            $first: '$_id',
          },
          registeredWebinarCount: {
            $sum: {
              $cond: [{ $eq: ['$isAttended', false] }, 1, 0],
            },
          },
          attendedWebinarCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$isAttended', true] },
                    { $gt: ['$timeInSession', 0] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          locations: {
            $addToSet: {
              $cond: [{ $ne: ['$location', null] }, '$location', '$$REMOVE'],
            },
          },
          sources: {
            $addToSet: {
              $cond: [{ $ne: ['$source', null] }, '$source', '$$REMOVE'],
            },
          },
          fullNames: {
            $addToSet: {
              $trim: {
                input: {
                  $concat: [
                    { $ifNull: ['$firstName', ''] },
                    ' ',
                    { $ifNull: ['$lastName', ''] },
                  ],
                },
              },
            },
          },
        },
      },

      {
        $match: {
          ...(filters.timeInSession && {
            timeInSession: filters.timeInSession,
          }),
          ...(filters.attendedWebinarCount && {
            attendedWebinarCount: filters.attendedWebinarCount,
          }),
          ...(filters.registeredWebinarCount && {
            registeredWebinarCount: filters.registeredWebinarCount,
          }),
        },
      },

      ...(this.checkLength(filters.leadType)
        ? [
            {
              $lookup: {
                from: 'attendeeassociations',
                let: { tempMail: '$_id' },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $eq: ['$adminId', adminId] },
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

                as: 'lead',
              },
            },
            {
              $unwind: {
                path: '$lead',
                preserveNullAndEmptyArrays: false,
              },
            },
          ]
        : []),

      ...(isLastFilters
        ? [
            {
              $addFields: {
                tags: {
                  $reduce: {
                    input: '$tagsList',
                    initialValue: [],
                    in: { $setUnion: ['$$value', '$$this'] },
                  },
                },
                salesAssignedTo: {
                  $first: '$salesAssignedToList',
                },
                salesLastStatus: {
                  $first: '$salesLastStatusList',
                },
                reminderAssignedTo: {
                  $first: '$reminderAssignedToList',
                },
                reminderLastStatus: {
                  $first: '$reminderLastStatusList',
                },
              },
            },
            {
              $match: {
                ...(this.checkLength(filters.salesAssignedTo) && {
                  salesAssignedTo: {
                    $in: filters.salesAssignedTo.map(
                      (a) => new Types.ObjectId(a),
                    ),
                  },
                }),
                ...(this.checkLength(filters.salesLastStatus) && {
                  salesLastStatus: {
                    $in: filters.salesLastStatus,
                  },
                }),
                ...(this.checkLength(filters.reminderAssignedTo) && {
                  reminderAssignedTo: {
                    $in: filters.reminderAssignedTo.map(
                      (a) => new Types.ObjectId(a),
                    ),
                  },
                }),
                ...(this.checkLength(filters.reminderLastStatus) && {
                  reminderLastStatus: {
                    $in: filters.reminderLastStatus,
                  },
                }),

                ...(this.checkLength(filters.tags) && {
                  $expr: {
                    $gt: [
                      {
                        $size: { $setIntersection: ['$tags', filters.tags] },
                      },
                      0,
                    ],
                  },
                }),
              },
            },
          ]
        : []),

      ...(filters?.enrollments?.length
        ? [
            {
              $lookup: {
                from: 'enrollments',
                let: {
                  tempMail: '$_id',
                  tempAdminId: new Types.ObjectId(`${adminId}`),
                },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          {
                            $eq: ['$attendee', '$$tempMail'],
                          },
                          {
                            $eq: ['$adminId', '$$tempAdminId'],
                          },
                        ],
                      },
                    },
                  },
                  {
                    $group: {
                      _id: {
                        product: '$product',
                        price: '$price',
                      },
                      count: {
                        $sum: 1,
                      },
                    },
                  },
                  {
                    $lookup: {
                      from: 'products',
                      localField: '_id.product',
                      foreignField: '_id',
                      as: 'product',
                    },
                  },
                  {
                    $unwind: {
                      path: '$product',
                      preserveNullAndEmptyArrays: true,
                    },
                  },
                  {
                    $addFields: {
                      label: {
                        $concat: [
                          '$product.name',
                          ' (',
                          { $toString: '$count' },
                          ') - ',
                          { $toString: '$_id.price' },
                        ],
                      },
                    },
                  },
                  {
                    $group: {
                      _id: null,
                      labels: { $push: '$label' },
                      ids: { $push: '$_id.product' },
                    },
                  },
                ],
                as: 'enrollments',
              },
            },
            {
              $unwind: {
                path: '$enrollments',
                preserveNullAndEmptyArrays: false,
              },
            },
            {
              $match: {
                'enrollments.ids': {
                  $in: filters.enrollments.map((id) => new Types.ObjectId(id)),
                },
              },
            },
          ]
        : []),
    ];

    const countPipeline: PipelineStage[] = [
      ...basePipeline,
      { $count: 'total' },
    ];

    const mainPipeline: PipelineStage[] = [
      ...basePipeline,
      {
        $sort: {
          [sort.sortBy]: sort.sortOrder === SortOrder.ASC ? 1 : -1,
        },
      },
      { $skip: skip },
      ...(limit ? [{ $limit: limit }] : []),
      ...(this.checkLength(filters.leadType)
        ? []
        : [
            {
              $lookup: {
                from: 'attendeeassociations',
                let: { tempMail: '$_id' },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $eq: ['$adminId', adminId] },
                          { $eq: ['$email', '$$tempMail'] }, // Match email with attendee email
                        ],
                      },
                    },
                  },
                ],

                as: 'lead',
              },
            },
            {
              $unwind: {
                path: '$lead',
                preserveNullAndEmptyArrays: true,
              },
            },
          ]),
      ...(!isLastFilters
        ? [
            {
              $addFields: {
                tags: {
                  $reduce: {
                    input: '$tagsList',
                    initialValue: [],
                    in: { $setUnion: ['$$value', '$$this'] },
                  },
                },
                salesAssignedTo: {
                  $first: '$salesAssignedToList',
                },
                salesLastStatus: {
                  $first: '$salesLastStatusList',
                },
                reminderAssignedTo: {
                  $first: '$reminderAssignedToList',
                },
                reminderLastStatus: {
                  $first: '$reminderLastStatusList',
                },
              },
            },
          ]
        : []),

      ...(filters?.enrollments?.length
        ? []
        : [
            {
              $lookup: {
                from: 'enrollments',
                let: { tempMail: '$_id' },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          {
                            $eq: ['$attendee', '$$tempMail'],
                          },
                          {
                            $eq: ['$adminId', new Types.ObjectId(`${adminId}`)],
                          },
                        ],
                      },
                    },
                  },
                  {
                    $group: {
                      _id: {
                        product: '$product',
                        price: '$price',
                      },
                      count: {
                        $sum: 1,
                      },
                    },
                  },
                  {
                    $lookup: {
                      from: 'products',
                      localField: '_id.product',
                      foreignField: '_id',
                      as: 'product',
                    },
                  },
                  {
                    $unwind: {
                      path: '$product',
                      preserveNullAndEmptyArrays: true,
                    },
                  },
                  {
                    $addFields: {
                      label: {
                        $concat: [
                          '$product.name',
                          ' (',
                          { $toString: '$count' },
                          ') - ',
                          { $toString: '$_id.price' },
                        ],
                      },
                    },
                  },
                  {
                    $group: {
                      _id: null,
                      labels: { $push: '$label' },
                    },
                  },
                  {
                    $project: {
                      _id: 0,
                      labels: 1,
                    },
                  },
                ],
                as: 'enrollments',
              },
            },
            {
              $unwind: {
                path: '$enrollments',
                preserveNullAndEmptyArrays: true,
              },
            },
          ]),
      {
        $project: {
          reminderLastStatus: 1,
          enrollments: '$enrollments.labels',
          salesLastStatus: 1,
          reminderAssignedTo: '$reminderAssignedToDetails.userName',
          salesAssignedTo: '$salesAssignedToDetails.userName',
          tags: 1,
          leadType: '$leadTypeDetails.label',
          adminId: 1,
          timeInSession: 1,
          attendeeId: 1,
          attendedWebinarCount: 1,
          registeredWebinarCount: 1,
          locations: 1,
          sources: 1,
          fullNames: {
            $filter: {
              input: '$fullNames',
              as: 'name',
              cond: { $ne: ['$$name', ''] },
            },
          },
        },
      },
      {
        $lookup: {
          from: 'attendees',
          let: { tempMail: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    {
                      $eq: ['$adminId', adminId],
                    },
                    { $eq: ['$email', '$$tempMail'] },
                    { $ne: ['$phone', null] },
                    { $ne: ['$phone', ''] },
                  ],
                },
              },
            },
            {
              $group: {
                _id: '$phone',
              },
            },
          ],
          as: 'phoneDetails',
        },
      },
    ];

    const [countResult, mainResult] = await Promise.all([
      this.attendeeModel.aggregate(countPipeline).exec(),
      this.attendeeModel.aggregate(mainPipeline).exec(),
    ]);

    const parsedData = mainResult.map((item) => ({
      email: item._id,
      ...item,
      enrollments: Array.isArray(item.enrollments)
        ? item.enrollments.join(',')
        : ' - ',
    }));

    const total = countResult[0]?.total || 0;
    const totalPages = limit ? Math.ceil(total / limit) || 1 : 1;
    const pagination = { page, totalPages, total };
    return { data: parsedData || [], pagination };
  }

  async getAttendeeForDeletion(
    webinarId: Types.ObjectId,
    session: ClientSession,
  ) {
    return await this.attendeeModel
      .find({ webinar: webinarId })
      .session(session);
  }

  async fetchAssigned(attendeeIds: Types.ObjectId[]) {
    return this.attendeeModel.find({
      _id: { $in: attendeeIds },
      assignedTo: { $ne: null },
    });
  }

  async fetchAttendees(attendeeIds: Types.ObjectId[]) {
    return this.attendeeModel.find({
      _id: { $in: attendeeIds },
    });
  }

  async updateAttendees(query: any, set: any, session?: ClientSession) {
    return this.attendeeModel.updateMany(
      query,
      { $set: set },
      { ...(session ? { session } : {}) },
    );
  }

  async fetchAttendeeByWebinar(email: string, webinarId: string) {
    return this.attendeeModel.findOne({
      email,
      webinar: new Types.ObjectId(webinarId),
    });
  }

  async fetchAttendeesByWebinar(webinarId: string): Promise<Attendee[]> {
    return this.attendeeModel.find({
      webinar: new Types.ObjectId(webinarId),
    });
  }

  async fetchAttendeeById(id: Types.ObjectId) {
    return this.attendeeModel.findById(id);
  }

  async getAttendeesByIds(
    adminId: Types.ObjectId,
    attendeeIds: Types.ObjectId[],
  ): Promise<Attendee[]> {
    return this.attendeeModel.find({
      _id: { $in: attendeeIds },
      adminId,
    });
  }

  async getAttendeeById(attendee: string): Promise<Attendee | null> {
    return this.attendeeModel.findById(new Types.ObjectId(`${attendee}`));
  }

  async getAttendeeByWebinarAndEmail(webinarId: string, email: string): Promise<Attendee | null> {
    return this.attendeeModel.findOne({
      webinar: new Types.ObjectId(webinarId),
      email,
      
    });
  }

  async bulkUpdateAttendees(
    updates: any[], // Using 'any' for simplicity, but you could type this more strictly if needed
    session: ClientSession, // Requires a session as it's designed for use within a transaction
  ): Promise<any> {
    // Return type reflects Mongoose bulkWrite result object
    if (!session) {
      // Although designed for transactions, adding a check is good practice
      throw new Error(
        'bulkUpdateAttendees requires a Mongoose client session.',
      );
    }
    if (!updates || updates.length === 0) {
      console.log(
        'bulkUpdateAttendees called with no updates. Returning early.',
      );
      // Return a result object indicating no operations were performed
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
      // Use the injected Mongoose model to perform the bulk write operation
      // Pass the array of update operations and the session object
      const result = await this.attendeeModel.bulkWrite(updates, { session });

      // Log the result or perform other checks if necessary
      // console.log('Attendee bulk write operation completed:', result);

      // Mongoose's bulkWrite returns an object containing statistics about the operations performed.
      // Example: { acknowledged: true, insertedCount: 0, matchedCount: 5, modifiedCount: 5, deletedCount: 0, upsertedCount: 0, upsertedIds: {} }
      return result;
    } catch (error) {
      console.error('Error during Attendee bulk write operation:', error);
      // Re-throw the error so the calling transaction can catch and handle it
      throw error;
    }
  }

  async getInvalidTags(adminId: Types.ObjectId) {
    const tags = await this.tagService.getTagsArray(adminId);

    const pipeline: PipelineStage[] = [
      {
        $match: {
          adminId,
          tags: { $exists: true, $ne: [] },
        },
      },

      { $unwind: '$tags' },

      {
        $match: {
          tags: { $nin: ['', null] },
        },
      },
      {
        $group: {
          _id: null,
          allTagsUsed: { $addToSet: '$tags' },
        },
      },
      {
        $project: {
          _id: 0,
          invalidTags: {
            $setDifference: ['$allTagsUsed', tags],
          },
        },
      },
    ];

    const result = await this.attendeeModel.aggregate(pipeline);
    if (Array.isArray(result) && result.length > 0) {
      return result[0].invalidTags || [];
    }

    return [];
  }
}
