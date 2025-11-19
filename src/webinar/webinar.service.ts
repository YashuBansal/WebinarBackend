import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { Webinar } from 'src/schemas/Webinar.schema';
import {
  CreateWebinarDto,
  UpdateWebinarDto,
  UpdateWebinarSettingDto,
} from './dto/createWebinar.dto';
import { AttendeesService } from 'src/attendees/attendees.service';
import { WebinarFilterDTO } from './dto/webinar-filter.dto';
import { NotificationService } from 'src/notification/notification.service';
import {
  notificationActionType,
  notificationType,
} from 'src/schemas/notification.schema';
import { AssignmentService } from 'src/assignment/assignment.service';
import { NotesService } from 'src/notes/notes.service';
import { AlarmService } from 'src/alarm/alarm.service';
import { EnrollmentsService } from 'src/enrollments/enrollments.service';
import { Logger } from '@nestjs/common';
import { SubscriptionService } from 'src/subscription/subscription.service';
import { MeetingEventConfigService } from 'src/meeting-event-config/meeting-event-config.service';
import {
  AttendeeFilterConditionDto,
  GetAttendeeCountDto,
} from './dto/attendee-count.dto';

@Injectable()
export class WebinarService {
  private readonly logger = new Logger(WebinarService.name);

  constructor(
    @InjectModel(Webinar.name) private webinarModel: Model<Webinar>,
    @Inject(forwardRef(() => AttendeesService))
    private readonly attendeesService: AttendeesService,
    private readonly notificationService: NotificationService,
    @Inject(forwardRef(() => NotesService))
    private readonly notesService: NotesService,
    @Inject(forwardRef(() => AlarmService))
    private readonly alarmService: AlarmService,
    @Inject(forwardRef(() => AssignmentService))
    private readonly assignmentService: AssignmentService,
    private readonly enrollmentService: EnrollmentsService,
    @Inject(forwardRef(() => SubscriptionService))
    private readonly subscriptionService: SubscriptionService,
    private readonly meetingEventConfigService: MeetingEventConfigService,
  ) {}

  async createWebiar(createWebinarDto: CreateWebinarDto): Promise<any> {
    // Trim and check if a webinar with the same name already exists (case-insensitive)
    const trimmedWebinarName = createWebinarDto.webinarName.trim();
    const escapedWebinarName = trimmedWebinarName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existingWebinar = await this.webinarModel.findOne({
      webinarName: { $regex: new RegExp(`^\\s*${escapedWebinarName}\\s*$`, 'i') },
      ...(createWebinarDto.adminId && {
        adminId: new Types.ObjectId(`${createWebinarDto.adminId}`),
      }),
    });

    if (existingWebinar) {
      throw new BadRequestException(
        `A webinar with the name "${trimmedWebinarName}" already exists`,
      );
    }

    // Create webinar with trimmed name
    const result = await this.webinarModel.create({
      ...createWebinarDto,
      webinarName: trimmedWebinarName,
    });

    if (result) {
      createWebinarDto.assignedEmployees.forEach(async (employeeId) => {
        // Create a notification for each assigned employee
        await this.notificationService.createNotification({
          recipient: `${employeeId}`,
          title: 'New Webinar Assigned',
          message: `You have been assigned to a new webinar: ${trimmedWebinarName}`,
          type: notificationType.INFO,
          actionType: notificationActionType.WEBINAR_ASSIGNMENT,
          metadata: {
            webinarId: result._id,
            webinarTitle: trimmedWebinarName,
          },
        });
      });
    }

    return result;
  }

  async getPreWebinarAttendeeCount(
    adminId: string,
    filters: GetAttendeeCountDto,
  ): Promise<number> {
    const { webinarIds, conditions = [] } = filters;
    // Validate that all webinars exist and belong to the admin
    const webinars = await this.webinarModel.find({
      _id: { $in: webinarIds.map(id => new Types.ObjectId(id)) },
      adminId: new Types.ObjectId(adminId)
    });

    if (webinars.length !== webinarIds.length) {
      throw new NotFoundException('One or more webinars not found');
    }

    // Convert to ObjectIds for the query
    const webinarObjectIds = webinarIds.map(id => new Types.ObjectId(id));

    // Get total count of attendees across all specified webinars
    const advancedQuery = this.buildAdvancedConditionsQuery(conditions);

    const attendees =
      await this.attendeesService.getAttendeesCountMultipleWebinars(
        webinarObjectIds,
        new Types.ObjectId(`${adminId}`),
        advancedQuery,
      );
    
    return attendees;
  }


  async getAllWebinars(adminId: string): Promise<any> {
    return await this.webinarModel.find({ adminId: new Types.ObjectId(adminId) });
  }

  async updateWebinarSettings(
    adminId: Types.ObjectId,
    data: UpdateWebinarSettingDto,
  ) {
    const webinarid = new Types.ObjectId(data.webinarId);

    const webinar = await this.webinarModel.findOne({
      _id: webinarid,
      adminId,
    });

    if (!webinar) {
      throw new NotFoundException('Webinar Not Found');
    }

    webinar.autoAssignmentDisabled = data.autoAssignmentDisabled;
    webinar.excludedEmployees = data.excludedEmployees.map(
      (a) => new Types.ObjectId(a),
    );

    await webinar.save();

    return webinar;
  }

  async getWebinars(
    adminId: string,
    page: number,
    limit: number,
    filters: WebinarFilterDTO = {},
    usePagination: boolean = true, // Flag to enable/disable pagination
  ): Promise<any> {
    console.log('limterr-r ===> ', limit);

    const skip = (page - 1) * limit;

    const query = { adminId: new Types.ObjectId(`${adminId}`) };

    const dateFilter: any = {};
    if (filters.webinarDate) {
      dateFilter['webinarDate'] = {};
      if (filters.webinarDate.$gte) {
        dateFilter['webinarDate']['$gte'] = new Date(filters.webinarDate.$gte);
      }
      if (filters.webinarDate.$lte) {
        dateFilter['webinarDate']['$lte'] = new Date(filters.webinarDate.$lte);
      }
    }

    // Base pipeline used for both cases
    const basePipeline: PipelineStage[] = [
      {
        $match: query,
      },
      {
        $match: {
          ...(filters.webinarName && {
            webinarName: { $regex: filters.webinarName, $options: 'i' },
          }),
          ...dateFilter,
          ...(Array.isArray(filters.assignedEmployee) &&
            filters.assignedEmployee.length > 0 && {
              assignedEmployees: {
                $in: filters.assignedEmployee.map(
                  (item) => new Types.ObjectId(item),
                ),
              },
            }),
        },
      },
      {
        $lookup: {
          from: 'attendees',
          localField: '_id',
          foreignField: 'webinar',
          as: 'attendees',
        },
      },
      {
        $project: {
          _id: 1,
          webinarName: 1,
          webinarDate: 1,
          assignedEmployees: 1,
          adminId: 1,
          createdAt: 1,
          updatedAt: 1,
          totalAttendees: {
            $size: {
              $filter: {
                input: '$attendees',
                as: 'attendee',
                cond: {
                  $and: [
                    { $eq: ['$$attendee.isAttended', true] },
                    { $gt: ['$$attendee.timeInSession', 0] },
                    { $ne: ['$$attendee.isDeleted', true] },
                  ],
                },
              },
            },
          },
          totalRegistrations: {
            $size: {
              $filter: {
                input: '$attendees',
                as: 'attendee',
                cond: {
                  $and: [
                    { $eq: ['$$attendee.isAttended', false] },
                    { $ne: ['$$attendee.isDeleted', true] },
                  ],
                },
              },
            },
          },

          totalParticipants: {
            $size: {
              $filter: {
                input: '$attendees',
                as: 'attendee',
                cond: {
                  $and: [
                    { $eq: ['$$attendee.isAttended', true] },
                    { $ne: ['$$attendee.isDeleted', true] },
                  ],
                },
              },
            },
          },
          productIds: 1,
        },
      },
      {
        $addFields: {
          totalUnAttended: {
            $subtract: ['$totalParticipants', '$totalAttendees'],
          },
        },
      },
      {
        $match: {
          ...(filters.totalRegistrations && {
            totalRegistrations: filters.totalRegistrations,
          }),
          ...(filters.totalAttendees && {
            totalAttendees: filters.totalAttendees,
          }),
          ...(filters.totalParticipants && {
            totalParticipants: filters.totalParticipants,
          }),
          ...(filters.totalUnAttended && {
            totalUnAttended: filters.totalUnAttended,
          }),
        },
      },
      {
        $sort: {
          createdAt: -1, // Sort by createdAt in descending order
        },
      },
    ];

    if (usePagination) {
      // Add $facet stage for pagination
      basePipeline.push(
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
            pagination: {
              totalPages: { $ceil: { $divide: ['$metadata.total', limit] } },
              page: { $literal: page },
              total: '$metadata.total',
              limit: { $literal: limit },
            },
            result: '$data',
          },
        },
      );

      const result = await this.webinarModel.aggregate(basePipeline);
      return result.length > 0
        ? result[0]
        : {
            result: [],
            pagination: { totalPages: 0, page: 1, total: 0, limit: limit },
          };
    } else {
      // Add skip and limit directly for consistent output without $facet
      basePipeline.push({ $skip: skip }, ...(limit ? [{ $limit: limit }] : []));

      const result = await this.webinarModel.aggregate(basePipeline);
      return {
        result, // Return all data
        page: 1, // Fixed page
        totalPages: 1, // No pagination
      };
    }
  }

  async getWebinar(id: string, adminId: string): Promise<any> {
    const result = await this.webinarModel
      .findOne({
        _id: new Types.ObjectId(`${id}`),
        adminId: new Types.ObjectId(`${adminId}`),
      })
      .populate('assignedEmployees')
      .populate('productIds')
      .lean();
    return result;
  }

  async updateWebinar(
    id: string,
    adminId: string,
    updateWebinarDto: UpdateWebinarDto,
  ): Promise<any> {
    const webinar = await this.webinarModel.findById(id);

    if (!webinar) {
      throw new NotFoundException('Webinar not found');
    }

    const previousAssigned = webinar.assignedEmployees || [];
    const updatedAssigned: any = updateWebinarDto.assignedEmployees || [];

    // Identify removed employees
    const removedEmployees = previousAssigned.filter(
      (empId: Types.ObjectId) => !updatedAssigned.includes(`${empId}`),
    );

    // If there are removed employees, check if they're assigned elsewhere
    if (removedEmployees.length > 0) {
      const isAssignmentExists =
        await this.assignmentService.checkAssignmentExists(
          removedEmployees,
          new Types.ObjectId(`${id}`),
        );

      if (isAssignmentExists) {
        throw new BadRequestException(
          'One or more removed employees are still assigned to another task',
        );
      }
    }

    // Proceed with the update
    const result = await this.webinarModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(id),
        adminId: new Types.ObjectId(adminId),
      },
      {
        $set: {
          ...updateWebinarDto,
        },
      },
      { new: true }, // return the updated document
    );

    return result;
  }

  async deleteWebinar(id: string, admin: string): Promise<any> {
    const webinarId = new Types.ObjectId(`${id}`);
    const adminId = new Types.ObjectId(`${admin}`);
    const session = await this.webinarModel.startSession();

    try {
      await session.withTransaction(async (currentSession) => {
        // Delete webinar
        const deletedWebinar = await this.webinarModel
          .findOneAndDelete({
            _id: webinarId,
            adminId: new Types.ObjectId(adminId),
          })
          .session(currentSession);

        if (!deletedWebinar) {
          throw new NotFoundException('Webinar not found');
        }

        const attendees: any =
          await this.attendeesService.getAttendeeForDeletion(
            webinarId,
            currentSession,
          );
        const attendeeIds = attendees.map((a) => a._id);

        // Configure deletion workflow
        await this.alarmService.deleteAlarmsByAttendeeIds(
          currentSession,
          attendeeIds,
        );

        await this.assignmentService.deleteAssignmentsByWebinar(
          currentSession,
          adminId,
          webinarId,
        );

        await this.attendeesService.deleteAttendeesByWebinar(
          currentSession,
          webinarId,
          adminId,
        );

        await this.enrollmentService.deleteEnrollmentsByWebinar(
          currentSession,
          adminId,
          webinarId,
        );

        await this.notesService.deleteNotesByAttendees(
          currentSession,
          attendeeIds,
        );

        await this.notificationService.deleteNotificationsByWebinar(
          currentSession,
          webinarId,
        );

        const contactCount =
          await this.attendeesService.getNonUniqueAttendeesCount(
            [],
            adminId,
            currentSession,
          );

        await this.subscriptionService.updateContactCount(
          adminId,
          contactCount,
          currentSession,
        );

        return { message: 'Webinar deleted successfully' };
      });
    } catch (error) {
      console.error('Transaction failed during hideAttendees:', error);
      throw new BadRequestException(error.message);
    } finally {
      await session.endSession();
      console.log('Session ended.');
    }
  }

  async getEmployeeWebinars(
    employeeId: string,
    adminId: string,
  ): Promise<Webinar[]> {
    const result = await this.webinarModel
      .find({
        assignedEmployees: { $in: [new Types.ObjectId(`${employeeId}`)] },
        adminId: new Types.ObjectId(`${adminId}`),
      })
      .sort({ createdAt: -1 });
    return result;
  }

  async getAssignedEmployees(webinarId: string): Promise<any> {
    const result: any = await this.webinarModel
      .findById(webinarId)
      .populate('assignedEmployees')
      .lean();

    if (!result || !Array.isArray(result.assignedEmployees)) return [];

    return (
      result.assignedEmployees.filter((employee) => employee?.isActive) || []
    );
  }

  async getWebinarById(webinarId: string): Promise<Webinar> {
    return this.webinarModel.findById(webinarId);
  }

  async getAssignedProducts(webinarId: Types.ObjectId) {
    return this.webinarModel.findById(webinarId).populate('productIds');
  }

  async updateAssignedEmployees(
    webinarId: Types.ObjectId,
    tempEmployees: Types.ObjectId[],
  ) {
    await this.webinarModel.findByIdAndUpdate(
      webinarId,
      { $set: { assignedEmployees: tempEmployees } },
      { new: true },
    );
  }

  async updateWebinarMeetingId(webinarId: string, meetingId: string, adminId: string): Promise<any> {
    const session = await this.webinarModel.startSession();
    this.logger.log(`Updating webinar meetingId: ${meetingId} for webinarId: ${webinarId} and adminId: ${adminId}`);
    try {
      await session.withTransaction(async (currentSession) => {
        // First, remove meetingId from any existing webinar that has it
        await this.webinarModel.updateMany(
          { 
            adminId: new Types.ObjectId(adminId),
            meetingId: meetingId,
            _id: { $ne: new Types.ObjectId(webinarId) }
          },
          { $unset: { meetingId: 1 } },
          { session: currentSession }
        );

        // Then update the target webinar with the meetingId
        const result = await this.webinarModel.findOneAndUpdate(
          {
            _id: new Types.ObjectId(webinarId),
            adminId: new Types.ObjectId(adminId),
          },
          { $set: { meetingId } },
          { new: true, session: currentSession }
        );

        if (!result) {
          throw new NotFoundException('Webinar not found');
        }

        await this.meetingEventConfigService.setWebinarIdIfConfigExists(
          new Types.ObjectId(adminId),
          meetingId,
          webinarId,
        );

        return result;
      });
    } finally {
      await session.endSession();
    }
  }

  async removeWebinarMeetingId(webinarId: string, adminId: string): Promise<any> {
    this.logger.log(`Removing webinar meetingId for webinarId: ${webinarId} and adminId: ${adminId}`);
    
    const webinar = await this.webinarModel.findById(webinarId);
    if (!webinar) {
      throw new NotFoundException('Webinar not found');
    }
    const previousMeetingId = webinar.meetingId;
    const result = await this.webinarModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(webinarId),
        adminId: new Types.ObjectId(adminId),
      },
      { $unset: { meetingId: 1 } },
      { new: true }
    );

    if (!result) {
      throw new NotFoundException('Webinar not found');
    }

    // Clear the linked webinarId in meeting-event-config (if a config exists) without sending webinarId
    try {
      
      if (previousMeetingId) {
        await this.meetingEventConfigService.setWebinarIdIfConfigExists(
          new Types.ObjectId(adminId),
          previousMeetingId,
        );
      }
    } catch (e) {
      this.logger.warn(`Failed to clear meeting-event-config webinarId on meetingId removal: ${e?.message || e}`);
    }

    return result;
  }

  async handleMeetingRegistration(
    meetingId: string,
    registrant: {
      id: string;
      first_name: string;
      last_name: string;
      email: string;
      phone: string;
    }
  ): Promise<any> {
    try {
      // Step 1: Check if meetingId is associated with a webinar
      const webinar = await this.webinarModel.findOne({ meetingId });
      
      if (!webinar) {
        this.logger.log(`No webinar found for meetingId: ${meetingId}`);
        return { message: 'No webinar associated with this meeting', webinar: null };
      }

      this.logger.log(`Found webinar: ${webinar.webinarName} for meetingId: ${meetingId}`);

      const postWebinarExists =
      await this.attendeesService.getPostWebinarAttendee(
        webinar._id.toString(),
      );  

      if (postWebinarExists) {
        this.logger.log(`Post webinar already exists for webinar: ${webinar.webinarName}`);
        return { message: 'Post webinar already exists', webinar: webinar.webinarName, attendee: postWebinarExists, action: 'exists' };
      }

      // Step 2: Check if attendee with this email already exists for this webinar
      const webinarAttendee = await this.attendeesService.getAttendeeByWebinarAndEmail(
        webinar._id.toString(),
        registrant.email
      );
      console.log('webinarAttendee', webinarAttendee);

      if (webinarAttendee) {
        // Update existing attendee data
        const updatedAttendee = await this.attendeesService.updateAttendee(
          webinarAttendee._id.toString(),
          webinar.adminId.toString(),
          webinar.adminId.toString(),  
          {
            firstName: registrant.first_name,
            lastName: registrant.last_name,
            isAttended: false, // Registration means not yet attended
            phone: registrant.phone,
            source: 'zoom',
          }
        );
        
        this.logger.log(`Updated existing attendee: ${registrant.email} for webinar: ${webinar.webinarName}`);
        return { 
          message: 'Attendee updated successfully', 
          webinar: webinar.webinarName,
          attendee: updatedAttendee,
          action: 'updated'
        };
      }

      // Create new attendee
      const newAttendeeData = {
        email: registrant.email,
        firstName: registrant.first_name,
        lastName: registrant.last_name,
        phone: registrant.phone,
        webinar: webinar._id as Types.ObjectId,
        adminId: webinar.adminId,
        isAttended: false, // Registration means not yet attended
        timeInSession: 0,
        source: 'zoom'
      };

      const newAttendee = await this.attendeesService.addAttendees([newAttendeeData]);

      this.logger.log(`Created new attendee: ${registrant.email} for webinar: ${webinar.webinarName}`);
      return { 
        message: 'Attendee created successfully', 
        webinar: webinar.webinarName,
        attendee: newAttendee[0],
        action: 'created'
      };
    } catch (error) {
      this.logger.error(`Error handling meeting registration for meetingId: ${meetingId}`, error);
      throw new BadRequestException(`Failed to handle meeting registration: ${error.message}`);
    }
  }

  async getWebinarRegistrations(webinarId: Types.ObjectId, adminId: Types.ObjectId) {
    return this.attendeesService.getAttendees(webinarId.toString(), adminId.toString(), false, 0,0,{filters: {}}, false);
  }

  private buildAdvancedConditionsQuery(
    conditions?: AttendeeFilterConditionDto[],
  ): Record<string, any> | null {
    if (!conditions?.length) {
      return null;
    }

    const compiled = conditions
      .map((condition, index) => {
        const expression = this.buildConditionExpression(condition);
        if (!expression) {
          return null;
        }
        return {
          expression,
          logicOperator: index === 0 ? 'AND' : condition.logicOperator ?? 'AND',
        };
      })
      .filter(Boolean) as Array<{
      expression: Record<string, any>;
      logicOperator: 'AND' | 'OR';
    }>;

    if (!compiled.length) {
      return null;
    }

    let combined = compiled[0].expression;

    for (let i = 1; i < compiled.length; i++) {
      const { expression, logicOperator } = compiled[i];
      if (logicOperator === 'OR') {
        combined = { $or: [combined, expression] };
      } else {
        combined = { $and: [combined, expression] };
      }
    }

    return combined;
  }

  private buildConditionExpression(
    condition: AttendeeFilterConditionDto,
  ): Record<string, any> | null {
    const values = (condition.value ?? [])
      .map((value) => value.trim())
      .filter(Boolean);

    if (!values.length) {
      return null;
    }

    const normalized =
      condition.field === 'email' || condition.field === 'tags'
        ? values.map((value) => value.toLowerCase())
        : values;

    let expression: Record<string, any>;

    if (condition.field === 'email') {
      expression =
        condition.operator === 'equals'
          ? { email: { $in: normalized } }
          : {
              $or: normalized.map((value) => ({
                email: {
                  $regex: this.escapeRegex(value),
                  $options: 'i',
                },
              })),
            };
    } else {
      expression =
        condition.operator === 'equals'
          ? { tags: { $in: normalized } }
          : {
              $or: normalized.map((value) => ({
                tags: {
                  $regex: this.escapeRegex(value),
                  $options: 'i',
                },
              })),
            };
    }

    if (condition.mode === 'exclude') {
      return { $nor: [expression] };
    }

    return expression;
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
