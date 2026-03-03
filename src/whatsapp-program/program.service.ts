import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  ConflictException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Program,
  ProgramDocument,
  IntervalUnit,
} from './schemas/program.schema';

/** Minimal slot shape for validation (DTO and schema both satisfy this). */
interface OccurrenceSlotInput {
  time?: string;
  timezone?: string;
  messageConfig?: {
    templateName?: string;
    variableMappings?: Array<{
      isDynamic?: boolean;
      contactField?: string;
      fallbackValue?: string;
      staticValue?: string;
    }>;
  };
}
import {
  ProgramAssignment,
  ProgramAssignmentDocument,
  ProgramAssignmentStatus,
  ProgramAssignmentSource,
} from './schemas/program-assignment.schema';
import {
  ProgramSlot,
  ProgramSlotDocument,
  ProgramSlotStatus,
} from './schemas/program-slot.schema';
import { CreateProgramDto } from './dto/create-program.dto';
import { UpdateProgramDto } from './dto/update-program.dto';
import { CreateProgramAssignmentDto } from './dto/create-program-assignment.dto';
import { ProjectsService } from 'src/projects/projects.service';
import {
  getBaseDateForOccurrence,
  getScheduledAtUTC,
} from './program-scheduler.util';
import { WhatsappService } from 'src/whatsapp/whatsapp.service';
import { ConfigService } from '@nestjs/config';
import { WabaMessageType } from 'src/whatsapp-embed/waba-message/waba-message.schema';
import { Queue } from 'bullmq';
import { PROGRAM_AUTO_ASSIGN_QUEUE } from './program.queue.module';
import { AttendeesService } from 'src/attendees/attendees.service';
import { AdvanceFilterResponseType } from 'src/attendees/dto/advance-attendee-filters.dto';
import { AutoAssignJobPayload } from './program-auto-assign.processor';

@Injectable()
export class ProgramService {
  private readonly logger = new Logger(ProgramService.name);

  constructor(
    @InjectModel(Program.name) private programModel: Model<ProgramDocument>,
    @InjectModel(ProgramAssignment.name)
    private programAssignmentModel: Model<ProgramAssignmentDocument>,
    @InjectModel(ProgramSlot.name)
    private programSlotModel: Model<ProgramSlotDocument>,
    private readonly projectService: ProjectsService,
    private readonly whatsappService: WhatsappService,
    private readonly configService: ConfigService,
    @Inject(PROGRAM_AUTO_ASSIGN_QUEUE)
    private readonly autoAssignQueue: Queue,
    @Inject(forwardRef(() => AttendeesService))
    private readonly attendeesService: AttendeesService,
  ) { }

  /** Input shape for computing total occurrence count (day vs week × weekdays). */
  private static readonly OCCURRENCE_CONFIG_MAX_NAME_LENGTH = 100;

  /**
   * Validates programId and returns ObjectId. Throws BadRequestException if missing or invalid.
   */
  private parseProgramId(programId: string): Types.ObjectId {
    if (programId == null || String(programId).trim() === '') {
      throw new BadRequestException('Program ID is required');
    }
    if (!Types.ObjectId.isValid(programId)) {
      throw new BadRequestException(`Invalid program ID: "${programId}"`);
    }
    return new Types.ObjectId(programId);
  }

  /**
   * Validates assignmentId and returns ObjectId. Throws BadRequestException if missing or invalid.
   */
  private parseAssignmentId(assignmentId: string): Types.ObjectId {
    if (assignmentId == null || String(assignmentId).trim() === '') {
      throw new BadRequestException('Assignment ID is required');
    }
    if (!Types.ObjectId.isValid(assignmentId)) {
      throw new BadRequestException(`Invalid assignment ID: "${assignmentId}"`);
    }
    return new Types.ObjectId(assignmentId);
  }

  /**
   * Total occurrence slots: when unit is day, occurrenceCount; when unit is week, occurrenceCount * (weekdays.length or 1).
   */
  getTotalOccurrenceCount(program: {
    occurrenceCount: number;
    intervalUnit: IntervalUnit | string;
    weekdays?: number[];
  }): number {
    const count = program.occurrenceCount ?? 0;
    if (program.intervalUnit === IntervalUnit.WEEK && program.weekdays?.length) {
      return count * program.weekdays.length;
    }
    return count;
  }

  private validateOccurrenceTimeSlots(
    occurrenceTimeSlots: OccurrenceSlotInput[][],
    totalRequired: number,
    prefix: string,
  ): void {
    if (
      !Array.isArray(occurrenceTimeSlots) ||
      occurrenceTimeSlots.length !== totalRequired
    ) {
      throw new BadRequestException(
        `${prefix} length must equal total occurrences (${totalRequired})`,
      );
    }
    occurrenceTimeSlots.forEach((slots, occIndex) => {
      (slots ?? []).forEach((slot, slotIndex) => {
        if (!slot.time?.trim() || !slot.timezone?.trim()) {
          throw new BadRequestException(
            `${prefix}[${occIndex}][${slotIndex}] must have valid time and timezone`,
          );
        }
        const cfg = slot.messageConfig;
        if (!cfg) {
          throw new BadRequestException(
            `${prefix}[${occIndex}][${slotIndex}].messageConfig is required`,
          );
        }
        if (!cfg.templateName?.trim()) {
          throw new BadRequestException(
            `${prefix}[${occIndex}][${slotIndex}].messageConfig.templateName is required`,
          );
        }
        const mappings = cfg.variableMappings ?? [];
        const hasInvalidMapping = mappings.some((vm) => {
          if (vm.isDynamic) {
            return !vm.contactField?.trim() || !vm.fallbackValue?.trim();
          }
          return !vm.staticValue?.trim();
        });
        if (hasInvalidMapping) {
          throw new BadRequestException(
            `${prefix}[${occIndex}][${slotIndex}].messageConfig.variableMappings is invalid`,
          );
        }
      });
    });
  }

  async create(
    dto: CreateProgramDto,
    adminId: string,
  ): Promise<{ program: Program; eligibleCount?: number }> {
    await this.projectService.findOne(
      new Types.ObjectId(adminId),
      new Types.ObjectId(dto.projectId),
    );
    if (!dto.occurrenceTimeSlots?.length) {
      throw new BadRequestException('occurrenceTimeSlots is required');
    }
    if (dto.intervalUnit === IntervalUnit.WEEK && dto.weekdays?.length === 0) {
      throw new BadRequestException(
        'When interval unit is week, at least one weekday is required',
      );
    }
    const totalRequired = this.getTotalOccurrenceCount(dto);
    this.validateOccurrenceTimeSlots(
      dto.occurrenceTimeSlots,
      totalRequired,
      'occurrenceTimeSlots',
    );
    const program = new this.programModel({
      ...dto,
      adminId: new Types.ObjectId(adminId),
      projectId: new Types.ObjectId(dto.projectId),
      isActive: dto.isActive ?? true,
    });

    const savedProgram = await program.save();

    let eligibleCount = 0;
    if (savedProgram.isAutoAssignable && savedProgram.autoAssignCriteria) {
      try {
        const criteria = savedProgram.autoAssignCriteria;
        const matchData = await this.attendeesService.fetchAttendeesByAdvanceFilters(
          {
            responseType: AdvanceFilterResponseType.COUNT,
            webinarIds: criteria.webinarIds || [],
            isAttended: criteria.isAttended,
            units: criteria.conditions || [],
          } as any,
          adminId
        );
        eligibleCount = matchData?.count || 0;

        if (eligibleCount > 0) {
          await this.autoAssignQueue.add('bulk-auto-assign', {
            type: 'BULK_ASSIGN',
            adminId,
            programId: savedProgram._id.toString()
          }, { removeOnComplete: true });
        }
      } catch (err) {
        this.logger.error(`Error enqueueing bulk assign on create`, err.stack);
      }
    }

    return { program: savedProgram, eligibleCount };
  }

  async update(
    programId: string,
    dto: UpdateProgramDto,
    adminId: string,
  ): Promise<{ program: Program; eligibleCount?: number }> {
    const program = await this.findOne(programId, adminId);

    const scheduleChanged =
      dto.occurrenceTimeSlots != null || dto.occurrenceCount != null;

    // Validations: name (if provided)
    if (dto.name !== undefined) {
      const trimmed = typeof dto.name === 'string' ? dto.name.trim() : '';
      if (trimmed.length === 0) {
        throw new BadRequestException('Program name cannot be empty');
      }
      if (trimmed.length > ProgramService.OCCURRENCE_CONFIG_MAX_NAME_LENGTH) {
        throw new BadRequestException(
          `Program name must not exceed ${ProgramService.OCCURRENCE_CONFIG_MAX_NAME_LENGTH} characters`,
        );
      }
    }

    // Validations: occurrenceCount (if provided)
    if (dto.occurrenceCount !== undefined) {
      const count = Number(dto.occurrenceCount);
      if (!Number.isInteger(count) || count < 1) {
        throw new BadRequestException(
          'occurrenceCount must be a positive integer',
        );
      }
    }

    // User is not allowed to change interval unit/value; use existing for validation and persist
    const existingIntervalUnit = program.intervalUnit;
    const existingIntervalValue = program.intervalValue;
    const existingWeekdays = program.weekdays;

    const merged: {
      occurrenceCount: number;
      intervalUnit: IntervalUnit;
      weekdays?: number[];
    } = {
      occurrenceCount: dto.occurrenceCount ?? program.occurrenceCount,
      intervalUnit: existingIntervalUnit,
      weekdays: existingWeekdays,
    };

    if (dto.occurrenceTimeSlots != null) {
      const totalRequired = this.getTotalOccurrenceCount(merged);
      this.validateOccurrenceTimeSlots(
        dto.occurrenceTimeSlots,
        totalRequired,
        'occurrenceTimeSlots',
      );
    }

    Object.assign(program, dto);
    if (dto.projectId != null) {
      program.projectId = new Types.ObjectId(dto.projectId);
    }
    // Keep existing interval unit and value; user is not allowed to edit them
    program.intervalUnit = existingIntervalUnit;
    program.intervalValue = existingIntervalValue;
    program.weekdays = existingWeekdays;

    const savedProgram = await program.save();

    let eligibleCount = 0;
    if (
      savedProgram.isAutoAssignable &&
      savedProgram.autoAssignCriteria &&
      dto.autoAssignCriteria != null
    ) {
      try {
        const criteria = savedProgram.autoAssignCriteria;
        const matchData = await this.attendeesService.fetchAttendeesByAdvanceFilters(
          {
            responseType: AdvanceFilterResponseType.COUNT,
            webinarIds: Array.isArray(criteria.webinarIds) ? criteria.webinarIds : [],
            isAttended: criteria.isAttended,
            units: criteria.conditions ?? [],
          },
          adminId,
        );
        eligibleCount = matchData?.count ?? 0;

        if (eligibleCount > 0) {
          await this.autoAssignQueue.add(
            'bulk-auto-assign',
            {
              type: 'BULK_ASSIGN',
              adminId,
              programId: savedProgram._id.toString(),
            },
            { removeOnComplete: true },
          );
        }
      } catch (err) {
        this.logger.error(
          'Error enqueueing bulk assign on update',
          err instanceof Error ? err.stack : String(err),
        );
      }
    }

    if (scheduleChanged) {
      await this.rebuildFutureSlotsForProgram(
        savedProgram as ProgramDocument,
        adminId,
      );
    }

    return { program: savedProgram, eligibleCount };
  }

  /**
   * Finds a program by id and admin. Returns only non-deleted programs.
   * @throws BadRequestException if programId is invalid
   * @throws NotFoundException if program does not exist or is deleted
   */
  async findOne(programId: string, adminId: string): Promise<ProgramDocument> {
    const id = this.parseProgramId(programId);
    const program = await this.programModel
      .findOne({
        _id: id,
        adminId: new Types.ObjectId(adminId),
      })
      .exec();
    if (!program) {
      throw new NotFoundException(`Program with ID "${programId}" not found.`);
    }
    return program as ProgramDocument;
  }

  async findAll(
    adminId: string,
    projectId?: string,
    page = 1,
    limit = 10,
  ): Promise<{
    programs: Program[];
    total: number;
    page: number;
    limit: number;
  }> {
    const filter: any = {
      adminId: new Types.ObjectId(adminId),
    };
    if (projectId) {
      filter.projectId = new Types.ObjectId(projectId);
    }
    const skip = (page - 1) * limit;
    const [programs, total] = await Promise.all([
      this.programModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.programModel.countDocuments(filter),
    ]);
    return { programs, total, page, limit };
  }

  async remove(programId: string, adminId: string): Promise<void> {
    const id = this.parseProgramId(programId);
    const session = await this.programModel.startSession();
    session.startTransaction();
    try {
      const program = await this.programModel
        .findOne({
          _id: id,
          adminId: new Types.ObjectId(adminId),
        })
        .session(session);

      if (!program) {
        throw new NotFoundException(`Program with ID "${programId}" not found.`);
      }

      program.isDeleted = true;
      program.isActive = false;
      await program.save({ session });

      const assignmentsToCancel = await this.programAssignmentModel.find({
        programId: program._id,
        status: { $in: [ProgramAssignmentStatus.SCHEDULED, ProgramAssignmentStatus.RUNNING, ProgramAssignmentStatus.PAUSED] },
      }).session(session);

      const assignmentIds = assignmentsToCancel.map(a => a._id);

      if (assignmentIds.length > 0) {
        await this.programAssignmentModel.updateMany(
          { _id: { $in: assignmentIds } },
          { $set: { status: ProgramAssignmentStatus.CANCELLED } },
          { session }
        );

        await this.programSlotModel.updateMany(
          {
            programAssignmentId: { $in: assignmentIds },
            status: { $in: [ProgramSlotStatus.PENDING, ProgramSlotStatus.PAUSED] },
          },
          { $set: { status: ProgramSlotStatus.CANCELLED } },
          { session }
        );
      }

      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async createAssignment(
    dto: CreateProgramAssignmentDto,
    adminId: string,
  ): Promise<ProgramAssignment> {
    await this.projectService.findOne(
      new Types.ObjectId(adminId),
      new Types.ObjectId(dto.projectId),
    );
    const program = await this.findOne(dto.programId, adminId);
    const existing = await this.programAssignmentModel.findOne({
      programId: new Types.ObjectId(dto.programId),
      phone: dto.phone,
    });
    if (existing) {
      throw new ConflictException(
        'This contact already has an assignment for this program.',
      );
    }
    let startAt = new Date(dto.startAt);
    if (isNaN(startAt.getTime())) {
      throw new BadRequestException('Invalid startAt date.');
    }

    // Auto assignment logic for shifting start date if slots would be missed today
    if (dto.source === ProgramAssignmentSource.AUTO) {
      const prog: any = program;
      const firstDaySlots = prog.occurrenceTimeSlots?.[0] || [];
      if (firstDaySlots.length > 0) {
        // get current time in attendee's timezone
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: dto.timezone || 'UTC',
          hour12: false,
          hourCycle: 'h23',
          hour: '2-digit',
          minute: '2-digit',
        });
        const nowInTimezone = formatter.format(new Date());

        // if any slot is earlier than nowInTimezone, we shift startAt to tomorrow 00:00:00 natively
        const missedAny = firstDaySlots.some(slot => slot.time < nowInTimezone);
        if (missedAny) {
          this.logger.log(`Shifting auto-assignment to next day for ${dto.phone} due to missed slots (now: ${nowInTimezone}).`)

          const tomorrowDate = new Date(startAt.getTime() + 24 * 60 * 60 * 1000);
          startAt = getScheduledAtUTC(tomorrowDate, '00:00', dto.timezone || 'UTC');
        }
      }
    }
    const assignment = new this.programAssignmentModel({
      programId: new Types.ObjectId(dto.programId),
      adminId: new Types.ObjectId(adminId),
      projectId: new Types.ObjectId(dto.projectId),
      startAt,
      timezone: dto.timezone,
      status: startAt <= new Date() ? ProgramAssignmentStatus.RUNNING : ProgramAssignmentStatus.SCHEDULED,
      dynamicVariables: dto.dynamicVariables ?? {},
      phone: dto.phone,
      source: dto.source || ProgramAssignmentSource.MANUAL,
      attendeeId: dto.attendeeId ? new Types.ObjectId(dto.attendeeId) : undefined,
    });
    const savedAssignment = (await assignment.save()) as ProgramAssignmentDocument;

    // Precompute ProgramSlot documents for this assignment
    try {
      const slotsToInsert = this.buildProgramSlotsForAssignment(
        program as ProgramDocument,
        savedAssignment,
        1,
      );

      if (slotsToInsert.length > 0) {
        await this.programSlotModel.insertMany(slotsToInsert);
        this.logger.log(
          `Created ${slotsToInsert.length} program slots for assignment ${savedAssignment._id}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Failed to precompute ProgramSlots for assignment ${assignment._id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return savedAssignment;
  }

  private buildProgramSlotsForAssignment(
    program: ProgramDocument,
    assignment: ProgramAssignmentDocument,
    fromOccurrence: number,
    totalOccurrencesOverride?: number,
    now: Date = new Date(),
  ): Partial<ProgramSlotDocument>[] {
    const totalOccurrences =
      typeof totalOccurrencesOverride === 'number'
        ? totalOccurrencesOverride
        : this.getTotalOccurrenceCount({
            occurrenceCount: program.occurrenceCount,
            intervalUnit: program.intervalUnit,
            weekdays: program.weekdays,
          });

    let occurrenceTimeSlots: OccurrenceSlotInput[][] =
      (program.occurrenceTimeSlots as unknown as OccurrenceSlotInput[][]) ?? [];

    type ProgramWithLegacySlots = ProgramDocument & {
      timeSlots?: OccurrenceSlotInput[];
    };

    const legacyTimeSlots = (program as ProgramWithLegacySlots).timeSlots;

    // Legacy fallback: flat timeSlots reused for each occurrence
    if (
      (!occurrenceTimeSlots || occurrenceTimeSlots.length === 0) &&
      Array.isArray(legacyTimeSlots) &&
      legacyTimeSlots.length > 0
    ) {
      occurrenceTimeSlots = Array.from(
        { length: totalOccurrences },
        () => legacyTimeSlots,
      );
    }

    if (!occurrenceTimeSlots || occurrenceTimeSlots.length === 0) {
      this.logger.warn(
        `No occurrenceTimeSlots for program ${program._id}, skipping ProgramSlot creation`,
      );
      return [];
    }

    const intervalUnit: IntervalUnit = program.intervalUnit ?? IntervalUnit.DAY;
    const weekdays: number[] | undefined = program.weekdays;
    const slotsToInsert: Partial<ProgramSlotDocument>[] = [];
    const startAt = assignment.startAt;

    for (let occ = Math.max(1, fromOccurrence); occ <= totalOccurrences; occ++) {
      const slotsForOccurrence = occurrenceTimeSlots[occ - 1] ?? [];
      if (!slotsForOccurrence || slotsForOccurrence.length === 0) {
        continue;
      }

      let baseDate: Date;
      if (intervalUnit === IntervalUnit.DAY) {
        baseDate = getBaseDateForOccurrence(
          startAt,
          occ,
          'day',
          program.intervalValue ?? 1,
        );
      } else if (intervalUnit === IntervalUnit.WEEK && weekdays?.length) {
        const weekIndex = Math.floor((occ - 1) / weekdays.length);
        const weekday = weekdays[(occ - 1) % weekdays.length];
        baseDate = getBaseDateForOccurrence(
          startAt,
          weekIndex + 1,
          'week',
          weekday,
        );
      } else {
        baseDate = getBaseDateForOccurrence(
          startAt,
          occ,
          'week',
          program.intervalValue ?? 1,
        );
      }

      for (
        let timeSlotIndex = 0;
        timeSlotIndex < slotsForOccurrence.length;
        timeSlotIndex++
      ) {
        const slot = slotsForOccurrence[timeSlotIndex];
        if (!slot.time || !slot.timezone) {
          continue;
        }

        const scheduledAt = getScheduledAtUTC(
          baseDate,
          slot.time,
          slot.timezone || assignment.timezone,
        );

        // Skip slots that are scheduled in the past
        if (scheduledAt < now) {
          continue;
        }

        slotsToInsert.push({
          programId: assignment.programId,
          programAssignmentId: assignment._id as Types.ObjectId,
          occurrenceIndex: occ,
          timeSlotIndex,
          scheduledAt,
          status: ProgramSlotStatus.PENDING,
        });
      }
    }

    return slotsToInsert;
  }

  private async rebuildFutureSlotsForProgram(
    program: ProgramDocument,
    adminId: string,
  ): Promise<void> {
    const totalOccurrences = this.getTotalOccurrenceCount({
      occurrenceCount: program.occurrenceCount,
      intervalUnit: program.intervalUnit,
      weekdays: program.weekdays,
    });

    if (totalOccurrences <= 0) {
      return;
    }

    const activeStatuses = [
      ProgramAssignmentStatus.SCHEDULED,
      ProgramAssignmentStatus.RUNNING,
      ProgramAssignmentStatus.PAUSED,
    ];

    const assignments = await this.programAssignmentModel
      .find({
        programId: program._id,
        adminId: program.adminId,
        status: { $in: activeStatuses },
      })
      .exec();

    if (!assignments.length) {
      return;
    }

    const now = new Date();

    for (const assignment of assignments) {
      const cutoffOcc =
        typeof assignment.currentOccurrence === 'number' &&
        assignment.currentOccurrence > 0
          ? assignment.currentOccurrence
          : 0;
      const fromOccurrence = cutoffOcc <= 0 ? 1 : cutoffOcc + 1;

      if (fromOccurrence > totalOccurrences) {
        continue;
      }

      await this.programSlotModel
        .deleteMany({
          programAssignmentId: assignment._id,
          occurrenceIndex: { $gte: fromOccurrence },
        })
        .exec();

      const slotsToInsert = this.buildProgramSlotsForAssignment(
        program,
        assignment,
        fromOccurrence,
        totalOccurrences,
        now,
      );

      if (slotsToInsert.length > 0) {
        await this.programSlotModel.insertMany(slotsToInsert);
      }
    }
  }

  /**
   * Process due ProgramSlot documents (used by central CronService).
   */
  async processDueProgramSlots(): Promise<void> {
    const now = new Date();
    const DEFAULT_BATCH_SIZE = 100;
    const batchSize =
      this.configService.get<number>('PROGRAM_SLOT_SCHEDULER_BATCH') ??
      DEFAULT_BATCH_SIZE;

    const pendingSlots = await this.programSlotModel
      .find({
        status: ProgramSlotStatus.PENDING,
        scheduledAt: { $lte: now },
      })
      .sort({ scheduledAt: 1 })
      .limit(batchSize)
      .exec();

    this.logger.log(
      `Program slots scheduler: found ${pendingSlots.length} pending slots at or before ${now.toISOString()}`,
    );

    if (!pendingSlots.length) {
      return;
    }

    for (const slot of pendingSlots) {
      try {
        const programId = Types.ObjectId.isValid(slot.programId)
          ? slot.programId.toString()
          : new Types.ObjectId(slot.programId).toString();
        const assignmentId = Types.ObjectId.isValid(slot.programAssignmentId)
          ? slot.programAssignmentId.toString()
          : new Types.ObjectId(slot.programAssignmentId).toString();

        // Load assignment with populated program data
        const assignment = await this.getAssignmentByIdForWorker(assignmentId);
        if (!assignment) {
          this.logger.warn(`Program assignment not found: ${assignmentId}`);
          await this.programSlotModel.updateOne(
            { _id: slot._id },
            {
              $set: {
                status: ProgramSlotStatus.FAILED,
                lastError: 'Program assignment not found',
              },
            },
          );
          continue;
        }

        const program: any = (assignment as any).programId;
        if (!program) {
          this.logger.warn(`Program missing for assignment: ${assignmentId}`);
          await this.programSlotModel.updateOne(
            { _id: slot._id },
            {
              $set: {
                status: ProgramSlotStatus.FAILED,
                lastError: 'Program missing for assignment',
              },
            },
          );
          continue;
        }

        const adminId = (assignment as any).adminId?.toString();
        const projectId = (assignment as any).projectId?.toString();
        if (!adminId || !projectId) {
          this.logger.warn(
            `Missing adminId/projectId on assignment ${assignmentId}`,
          );
          await this.programSlotModel.updateOne(
            { _id: slot._id },
            {
              $set: {
                status: ProgramSlotStatus.FAILED,
                lastError: 'Missing adminId or projectId on assignment',
              },
            },
          );
          continue;
        }

        const occurrenceTimeSlots = (program as any).occurrenceTimeSlots ?? [];
        const occurrenceSlots =
          occurrenceTimeSlots[slot.occurrenceIndex - 1] ?? [];
        const slotConfig = occurrenceSlots[slot.timeSlotIndex];
        const messageConfig = slotConfig?.messageConfig;
        if (!messageConfig) {
          this.logger.warn(
            `No message config for slot ${slot.timeSlotIndex} in program ${programId}`,
          );
          await this.programSlotModel.updateOne(
            { _id: slot._id },
            {
              $set: {
                status: ProgramSlotStatus.FAILED,
                lastError: 'No message config for program slot',
              },
            },
          );
          continue;
        }

        const templateName = messageConfig.templateName;
        const dynamicVariables = (assignment as any).dynamicVariables ?? {};
        const bodyVariables: string[] = (
          messageConfig.variableMappings ?? []
        ).map(
          (m: {
            isDynamic?: boolean;
            contactField?: string;
            staticValue?: string;
            fallbackValue?: string;
          }) => {
            if (m.isDynamic) {
              const field = (m.contactField ?? '').replace(/^\$/, '');
              return dynamicVariables[field] ?? m.fallbackValue ?? '';
            }
            return m.staticValue ?? m.fallbackValue ?? '';
          },
        );

        const phone = (assignment as any).phone ?? '';
        if (!phone) {
          this.logger.warn(
            `Missing phone on assignment ${assignmentId}, cannot send program message`,
          );
          await this.programSlotModel.updateOne(
            { _id: slot._id },
            {
              $set: {
                status: ProgramSlotStatus.FAILED,
                lastError: 'Missing phone on assignment',
              },
            },
          );
          continue;
        }

        const result = await this.whatsappService.sendTemplateMessagev2({
          adminId,
          messageType: WabaMessageType.PROGRAM,
          sendTemplateDto: {
            projectId,
            recipients: [
              {
                recipientPhoneNumber: phone,
                bodyVariables,
              },
            ],
            templateName,
            headerMediaAssetId: messageConfig.headerMediaAssetId,
            language: messageConfig.language,
          },
          programId,
          programAssignmentId: assignmentId,
          programSlotId: slot._id.toString(),
        });

        const stats = result?.stats;
        const enqueued = stats?.enqueued ?? 0;
        if (enqueued === 1) {
          await this.programSlotModel.updateOne(
            { _id: slot._id, status: ProgramSlotStatus.PENDING },
            { $set: { status: ProgramSlotStatus.ENQUEUED, lastError: undefined } },
          );
        } else {
          const errorMessage =
            stats?.errors?.[0] ||
            result?.message ||
            'Failed to enqueue program slot message';
          this.logger.warn(
            `sendTemplateMessagev2 did not enqueue message for program slot ${slot._id}: ${errorMessage}`,
          );
          await this.programSlotModel.updateOne(
            { _id: slot._id },
            {
              $set: {
                status: ProgramSlotStatus.FAILED,
                lastError: errorMessage,
              },
            },
          );
        }
      } catch (err) {
        this.logger.warn(
          `Failed to enqueue program slot ${slot._id}: ${err instanceof Error ? err.message : String(err)
          }`,
        );
        await this.programSlotModel.updateOne(
          { _id: slot._id },
          {
            $set: {
              status: ProgramSlotStatus.FAILED,
              lastError: err instanceof Error ? err.message : String(err),
            },
          },
        );
      }
    }
  }

  async listAssignments(
    adminId: string,
    programId?: string,
    projectId?: string,
    status?: ProgramAssignmentStatus,
    page = 1,
    limit = 10,
  ): Promise<{
    assignments: any[];
    total: number;
    page: number;
    limit: number;
  }> {
    const filter: any = { adminId: new Types.ObjectId(adminId) };
    if (programId) filter.programId = new Types.ObjectId(programId);
    if (projectId) filter.projectId = new Types.ObjectId(projectId);
    if (status) filter.status = status;
    const skip = (page - 1) * limit;
    const [assignmentsData, total] = await Promise.all([
      this.programAssignmentModel
        .find(filter)
        .populate(
          'programId',
          'name occurrenceCount intervalValue intervalUnit',
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.programAssignmentModel.countDocuments(filter),
    ]);

    const assignmentIds = assignmentsData.map((a: any) => a._id);
    let statsMap = new Map<string, any>();

    if (assignmentIds.length > 0) {
      const statsAggregation = await this.programSlotModel.aggregate([
        { $match: { programAssignmentId: { $in: assignmentIds } } },
        {
          $group: {
            _id: '$programAssignmentId',
            totalSlots: { $sum: 1 },
            completedSlots: {
              $sum: {
                $cond: [{ $in: ['$status', [ProgramSlotStatus.SKIPPED, ProgramSlotStatus.ENQUEUED, '']] }, 1, 0],
              },
            },
            pendingSlots: {
              $sum: { $cond: [{ $in: ['$status', [ProgramSlotStatus.PENDING, ProgramSlotStatus.PAUSED]] }, 1, 0] },
            },
            failedSlots: {
              $sum: { $cond: [{ $eq: ['$status', ProgramSlotStatus.FAILED] }, 1, 0] },
            },
            nextSlotDate: {
              $min: {
                $cond: [{ $eq: ['$status', ProgramSlotStatus.PENDING] }, '$scheduledAt', null],
              },
            },
            currentOccurrence: {
              $max: {
                $cond: [
                  { $in: ['$status', [ProgramSlotStatus.SKIPPED, ProgramSlotStatus.ENQUEUED]] },
                  '$occurrenceIndex',
                  0,
                ],
              },
            },
          },
        },
      ]);
      statsMap = new Map(statsAggregation.map((s) => [s._id.toString(), s]));
    }

    const assignments = assignmentsData.map((a: any) => ({
      ...a,
      stats: statsMap.get(a._id.toString()) || {
        totalSlots: 0,
        completedSlots: 0,
        pendingSlots: 0,
        failedSlots: 0,
        nextSlotDate: null,
        currentOccurrence: 0,
      },
      id: a._id.toString(),
    }));

    return { assignments, total, page, limit };
  }

  async findAssignment(
    assignmentId: string,
    adminId: string,
  ): Promise<ProgramAssignmentDocument> {
    const assignment = await this.programAssignmentModel
      .findOne({
        _id: new Types.ObjectId(assignmentId),
        adminId: new Types.ObjectId(adminId),
      })
      .populate('programId')
      .exec();
    if (!assignment) {
      throw new NotFoundException(`Assignment "${assignmentId}" not found.`);
    }
    return assignment as ProgramAssignmentDocument;
  }

  async getAssignmentSlots(
    assignmentId: string,
    adminId: string,
  ): Promise<any[]> {
    // Validate assignment exists and belongs to admin
    await this.findAssignment(assignmentId, adminId);

    return this.programSlotModel
      .aggregate([
        { $match: { programAssignmentId: new Types.ObjectId(assignmentId) } },
        { $sort: { occurrenceIndex: 1, timeSlotIndex: 1 } },
        {
          $lookup: {
            from: 'wabamessages',
            let: { slot_id: '$_id' },
            pipeline: [
              { $match: { $expr: { $eq: ['$programSlotId', '$$slot_id'] } } },
              {
                $project: {
                  status: 1,
                  statusHistory: 1,
                  failureReason: 1,
                  sentAt: 1,
                  deliveredAt: 1,
                  readAt: 1,
                  wabaMessageId: 1
                }
              }
            ],
            as: 'wabaMessage',
          },
        },
        {
          $unwind: {
            path: '$wabaMessage',
            preserveNullAndEmptyArrays: true,
          },
        },
      ])
      .exec();
  }

  async pauseAssignment(
    assignmentId: string,
    adminId: string,
  ): Promise<ProgramAssignment> {
    const assignment = await this.findAssignment(assignmentId, adminId);
    if (assignment.status !== ProgramAssignmentStatus.RUNNING && assignment.status !== ProgramAssignmentStatus.SCHEDULED) {
      throw new BadRequestException(
        `Cannot pause assignment in status "${assignment.status}".`,
      );
    }
    assignment.status = ProgramAssignmentStatus.PAUSED;
    assignment.pausedAt = new Date();
    await assignment.save();

    // Pause all pending/enqueued slots
    await this.programSlotModel.updateMany(
      {
        programAssignmentId: assignment._id,
        status: { $in: [ProgramSlotStatus.PENDING] },
      },
      { $set: { status: ProgramSlotStatus.PAUSED } }
    );

    return assignment;
  }

  async resumeAssignment(
    assignmentId: string,
    adminId: string,
  ): Promise<ProgramAssignment> {
    const assignment = await this.findAssignment(assignmentId, adminId);
    if (assignment.status !== ProgramAssignmentStatus.PAUSED) {
      throw new BadRequestException(
        `Cannot resume assignment in status "${assignment.status}".`,
      );
    }
    assignment.status = ProgramAssignmentStatus.RUNNING;
    assignment.pausedAt = undefined;
    await assignment.save();

    // Find all paused slots that belong to this assignment and handle them
    const pausedSlots = await this.programSlotModel.find({
      programAssignmentId: assignment._id,
      status: ProgramSlotStatus.PAUSED,
    });

    if (pausedSlots.length > 0) {
      const now = new Date();
      const pastSlotIds = [];
      const futureSlotIds = [];

      for (const slot of pausedSlots) {
        if (slot.scheduledAt < now) {
          pastSlotIds.push(slot._id);
        } else {
          futureSlotIds.push(slot._id);
        }
      }

      // Past slots get skipped
      if (pastSlotIds.length > 0) {
        await this.programSlotModel.updateMany(
          { _id: { $in: pastSlotIds } },
          { $set: { status: ProgramSlotStatus.SKIPPED } }
        );
      }

      // Future slots get resumed
      if (futureSlotIds.length > 0) {
        await this.programSlotModel.updateMany(
          { _id: { $in: futureSlotIds } },
          { $set: { status: ProgramSlotStatus.PENDING } }
        );
      }
    }

    return assignment;
  }

  async cancelAssignment(
    assignmentId: string,
    adminId: string,
  ): Promise<ProgramAssignment> {
    const assignment = await this.findAssignment(assignmentId, adminId);
    if (
      assignment.status === ProgramAssignmentStatus.COMPLETED ||
      assignment.status === ProgramAssignmentStatus.CANCELLED
    ) {
      throw new BadRequestException(
        `Assignment is already ${assignment.status}.`,
      );
    }
    assignment.status = ProgramAssignmentStatus.CANCELLED;
    await assignment.save();

    // Cancel all slots that haven't been completed or permanently failed
    await this.programSlotModel.updateMany(
      {
        programAssignmentId: assignment._id,
        status: { $in: [ProgramSlotStatus.PENDING, ProgramSlotStatus.PAUSED] },
      },
      { $set: { status: ProgramSlotStatus.CANCELLED } }
    );

    return assignment;
  }

  async getAssignmentById(
    assignmentId: Types.ObjectId,
  ): Promise<ProgramAssignmentDocument | null> {
    return this.programAssignmentModel
      .findById(assignmentId)
      .populate('programId')
      .exec() as Promise<ProgramAssignmentDocument | null>;
  }

  async getAssignmentByIdForWorker(
    assignmentId: string,
  ): Promise<ProgramAssignmentDocument | null> {
    return this.programAssignmentModel
      .findById(assignmentId)
      .populate('programId')
      .exec() as Promise<ProgramAssignmentDocument | null>;
  }

  async getProgramById(
    programId: Types.ObjectId,
  ): Promise<ProgramDocument | null> {
    return this.programModel
      .findOne({ _id: programId, isDeleted: false })
      .exec() as Promise<ProgramDocument | null>;
  }

  async incrementAssignmentFailureCount(
    assignmentId: Types.ObjectId,
  ): Promise<void> {
    await this.programAssignmentModel
      .updateOne({ _id: assignmentId }, { $inc: { failureCount: 1 } })
      .exec();
  }

  async pauseAssignmentOnFailure(assignmentId: Types.ObjectId): Promise<void> {
    await this.programAssignmentModel
      .updateOne(
        { _id: assignmentId },
        { $set: { status: ProgramSlotStatus.PAUSED, pausedAt: new Date() } },
      )
      .exec();
  }

  // --- Auto Assign Logic ---

  async processBulkAutoAssignJob(payload: AutoAssignJobPayload) {
    const { adminId, programId } = payload;
    if (!programId) return;

    const program = await this.findOne(programId, adminId);
    if (!program.isAutoAssignable || !program.autoAssignCriteria) return;

    try {
      // 1. Fetch eligible attendees
      const criteria = program.autoAssignCriteria;
      // Convert to DTO expected by attendeesService
      const matchData = await this.attendeesService.fetchAttendeesByAdvanceFilters(
        {
          responseType: AdvanceFilterResponseType.DATA,
          webinarIds: criteria.webinarIds || [],
          isAttended: criteria.isAttended,
          units: criteria.conditions || [],
        } as any, // bypassing strict class validation since it's internal trusted payload
        adminId
      );

      const eligibleAttendees = matchData?.data || [];
      if (!eligibleAttendees.length) return;

      this.logger.log(`Found ${eligibleAttendees.length} eligible attendees for bulk auto-assignment to program ${programId}`);

      // 2. Loop and assign
      for (const attendee of eligibleAttendees) {
        if (!attendee.phone) continue;

        // Check if assignment already exists, ignore status to avoid duplicates on failures
        const existing = await this.programAssignmentModel.findOne({
          programId: new Types.ObjectId(programId),
          phone: attendee.phone,
        });

        if (existing) continue;

        // Create assignment (starting immediately)
        try {
          await this.createAssignment(
            {
              programId: programId,
              projectId: program.projectId.toString(),
              startAt: new Date().toISOString(),
              timezone: attendee.timezone || 'UTC', // Default to UTC if not found
              phone: attendee.phone,
              dynamicVariables: {
                firstName: attendee.firstName || '',
                lastName: attendee.lastName || '',
                email: attendee.email || '',
              },
              source: ProgramAssignmentSource.AUTO,
              attendeeId: attendee._id.toString()
            },
            adminId
          );
        } catch (assignErr) {
          this.logger.error(`Failed to bulk auto-assign attendee ${attendee._id} to program ${programId}: ${assignErr.message}`);
        }
      }
    } catch (err) {
      this.logger.error(`Error processing bulk auto-assign job for program ${programId}`, err.stack);
    }
  }

  async evaluateAllAutoAssignments(): Promise<void> {
    try {
      // 1. Find all active auto-assignable programs
      const activePrograms = await this.programModel.find({
        isActive: true,
        isDeleted: false,
        isAutoAssignable: true,
      });

      if (!activePrograms.length) return;
      this.logger.log(`Cron: Evaluating auto-assignments for ${activePrograms.length} programs`);

      for (const program of activePrograms) {
        if (!program.autoAssignCriteria) continue;
        const criteria = program.autoAssignCriteria;
        const adminId = program.adminId.toString();

        const matchData = await this.attendeesService.fetchAttendeesByAdvanceFilters(
          {
            responseType: AdvanceFilterResponseType.DATA,
            webinarIds: criteria.webinarIds || [],
            isAttended: criteria.isAttended,
            units: criteria.conditions || [],
          } as any,
          adminId
        );

        const eligibleAttendees = matchData?.data || [];
        if (!eligibleAttendees.length) continue;

        let assignedCount = 0;
        for (const attendee of eligibleAttendees) {
          if (!attendee.phone) continue;

          // Check if ANY assignment already exists for this program + phone combo
          const existing = await this.programAssignmentModel.findOne({
            programId: program._id,
            phone: attendee.phone,
          });

          if (existing) continue;

          // Create assignment
          try {
            await this.createAssignment(
              {
                programId: program._id.toString(),
                projectId: program.projectId.toString(),
                startAt: new Date().toISOString(),
                timezone: (attendee as any).timezone || 'UTC',
                phone: attendee.phone,
                dynamicVariables: {
                  firstName: attendee.firstName || '',
                  lastName: attendee.lastName || '',
                  email: attendee.email || '',
                },
                source: ProgramAssignmentSource.AUTO,
                attendeeId: attendee._id.toString()
              },
              adminId
            );
            assignedCount++;
          } catch (assignErr) {
            this.logger.error(`Failed to cron auto-assign attendee ${attendee._id} to program ${program._id}: ${assignErr.message}`);
          }
        }

        if (assignedCount > 0) {
          this.logger.log(`Cron auto-assigned ${assignedCount} new attendees to program ${program._id}`);
        }
      }
    } catch (err) {
      this.logger.error(`Error in evaluateAllAutoAssignments cron`, err.stack);
    }
  }

  async markAssignmentCompleted(assignmentId: Types.ObjectId): Promise<void> {
    await this.programAssignmentModel
      .updateOne(
        { _id: assignmentId },
        { $set: { status: ProgramAssignmentStatus.COMPLETED, completedAt: new Date() } },
      )
      .exec();
  }

  async pauseRunningAssignmentsForContactByPhone(
    projectId: string,
    phone: string,
  ): Promise<void> {
    // Feature "pause on reply" has been removed.
    // This method is kept for backward compatibility but intentionally does nothing.
    return;
  }

  async getRunningAssignmentsForScheduler(): Promise<
    ProgramAssignmentDocument[]
  > {
    const now = new Date();
    await this.programAssignmentModel
      .updateMany(
        { status: ProgramAssignmentStatus.SCHEDULED, startAt: { $lte: now } },
        { $set: { status: ProgramAssignmentStatus.RUNNING } },
      )
      .exec();
    return this.programAssignmentModel
      .find({
        status: ProgramAssignmentStatus.RUNNING,
        failureCount: { $lt: 3 },
      })
      .populate('programId')
      .exec() as Promise<ProgramAssignmentDocument[]>;
  }
}
