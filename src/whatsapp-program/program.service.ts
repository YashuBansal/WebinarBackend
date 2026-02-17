import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  UnauthorizedException,
  ConflictException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Program, ProgramDocument } from './schemas/program.schema';
import {
  ProgramAssignment,
  ProgramAssignmentDocument,
  ProgramAssignmentStatus,
} from './schemas/program-assignment.schema';
import {
  ProgramSlot,
  ProgramSlotDocument,
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
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsappService: WhatsappService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Total occurrence slots: when unit is day, occurrenceCount; when unit is week, occurrenceCount * (weekdays.length or 1).
   */
  getTotalOccurrenceCount(program: {
    occurrenceCount: number;
    intervalUnit: string;
    weekdays?: number[];
  }): number {
    const count = program.occurrenceCount ?? 0;
    if (program.intervalUnit === 'week' && program.weekdays?.length) {
      return count * program.weekdays.length;
    }
    return count;
  }

  private validateOccurrenceTimeSlots(
    occurrenceTimeSlots: {
      time?: string;
      timezone?: string;
      messageConfig?: any;
    }[][],
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
        if (!slot.time || !slot.timezone) {
          throw new BadRequestException(
            `${prefix}[${occIndex}][${slotIndex}] must have valid time and timezone`,
          );
        }
        if (!slot.messageConfig) {
          throw new BadRequestException(
            `${prefix}[${occIndex}][${slotIndex}].messageConfig is required`,
          );
        }
        const cfg: any = slot.messageConfig;
        if (!cfg.templateName || !cfg.templateName.trim()) {
          throw new BadRequestException(
            `${prefix}[${occIndex}][${slotIndex}].messageConfig.templateName is required`,
          );
        }
        const mappings: any[] = cfg.variableMappings ?? [];
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

  async create(dto: CreateProgramDto, adminId: string): Promise<Program> {
    await this.projectService.findOne(
      new Types.ObjectId(adminId),
      new Types.ObjectId(dto.projectId),
    );
    if (!dto.occurrenceTimeSlots?.length) {
      throw new BadRequestException('occurrenceTimeSlots is required');
    }
    if (dto.intervalUnit === 'week' && dto.weekdays?.length === 0) {
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
    return program.save();
  }

  async update(
    programId: string,
    dto: UpdateProgramDto,
    adminId: string,
  ): Promise<Program> {
    const program = await this.findOne(programId, adminId);
    const merged = {
      occurrenceCount: dto.occurrenceCount ?? (program as any).occurrenceCount,
      intervalUnit: dto.intervalUnit ?? (program as any).intervalUnit,
      weekdays:
        dto.weekdays !== undefined ? dto.weekdays : (program as any).weekdays,
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
    if (dto.projectId) program.projectId = new Types.ObjectId(dto.projectId);
    return program.save();
  }

  async findOne(programId: string, adminId: string): Promise<ProgramDocument> {
    const program = await this.programModel
      .findOne({
        _id: new Types.ObjectId(programId),
        adminId: new Types.ObjectId(adminId),
        isDeleted: false,
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
      isDeleted: false,
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
    const program = await this.findOne(programId, adminId);
    (program as any).isDeleted = true;
    await program.save();
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
      status: { $in: ['scheduled', 'running', 'paused'] },
    });
    if (existing) {
      throw new ConflictException(
        'This contact already has an active assignment for this program.',
      );
    }
    const startAt = new Date(dto.startAt);
    if (isNaN(startAt.getTime())) {
      throw new BadRequestException('Invalid startAt date.');
    }
    const assignment = new this.programAssignmentModel({
      programId: new Types.ObjectId(dto.programId),
      adminId: new Types.ObjectId(adminId),
      projectId: new Types.ObjectId(dto.projectId),
      startAt,
      timezone: dto.timezone,
      status: startAt <= new Date() ? 'running' : 'scheduled',
      dynamicVariables: dto.dynamicVariables ?? {},
      phone: dto.phone,
    });
    const savedAssignment = await assignment.save();

    // Precompute ProgramSlot documents for this assignment
    try {
      const prog: any = program;
      const totalOccurrences = this.getTotalOccurrenceCount(prog);
      let occurrenceTimeSlots: any[] = prog.occurrenceTimeSlots ?? [];
      // Legacy fallback: flat timeSlots reused for each occurrence
      if (
        (!occurrenceTimeSlots || occurrenceTimeSlots.length === 0) &&
        Array.isArray(prog.timeSlots) &&
        prog.timeSlots.length > 0
      ) {
        occurrenceTimeSlots = Array.from(
          { length: totalOccurrences },
          () => prog.timeSlots,
        );
      }

      if (!occurrenceTimeSlots || occurrenceTimeSlots.length === 0) {
        this.logger.warn(
          `No occurrenceTimeSlots for program ${prog._id}, skipping ProgramSlot creation`,
        );
      } else {
        const intervalUnit: 'day' | 'week' = prog.intervalUnit ?? 'day';
        const weekdays: number[] | undefined = prog.weekdays;
        const slotsToInsert: Partial<ProgramSlotDocument>[] = [];

        for (let occ = 1; occ <= totalOccurrences; occ++) {
          const slotsForOccurrence = occurrenceTimeSlots[occ - 1] ?? [];
          if (!slotsForOccurrence || slotsForOccurrence.length === 0) {
            continue;
          }

          let baseDate: Date;
          if (intervalUnit === 'day') {
            baseDate = getBaseDateForOccurrence(
              startAt,
              occ,
              'day',
              prog.intervalValue ?? 1,
            );
          } else if (intervalUnit === 'week' && weekdays?.length) {
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
              prog.intervalValue ?? 1,
            );
          }

          for (
            let timeSlotIndex = 0;
            timeSlotIndex < slotsForOccurrence.length;
            timeSlotIndex++
          ) {
            const slot = slotsForOccurrence[timeSlotIndex];
            const scheduledAt = getScheduledAtUTC(
              baseDate,
              slot.time,
              slot.timezone || savedAssignment.timezone,
            );
            slotsToInsert.push({
              programId: savedAssignment.programId,
              programAssignmentId: savedAssignment._id,
              occurrenceIndex: occ,
              timeSlotIndex,
              scheduledAt,
              status: 'pending',
            } as any);
          }
        }

        if (slotsToInsert.length > 0) {
          await this.programSlotModel.insertMany(slotsToInsert);
          this.logger.log(
            `Created ${slotsToInsert.length} program slots for assignment ${savedAssignment._id}`,
          );
        }
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
        status: 'pending',
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

        await this.whatsappService.enqueueProgramSlot({
          programId,
          programAssignmentId: assignmentId,
          occurrenceIndex: slot.occurrenceIndex,
          timeSlotIndex: slot.timeSlotIndex,
        });

        await this.programSlotModel.updateOne(
          { _id: slot._id, status: 'pending' },
          { $set: { status: 'enqueued', lastError: undefined } },
        );
      } catch (err) {
        this.logger.warn(
          `Failed to enqueue program slot ${slot._id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        await this.programSlotModel.updateOne(
          { _id: slot._id },
          {
            $set: {
              status: 'failed',
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
    assignments: ProgramAssignment[];
    total: number;
    page: number;
    limit: number;
  }> {
    const filter: any = { adminId: new Types.ObjectId(adminId) };
    if (programId) filter.programId = new Types.ObjectId(programId);
    if (projectId) filter.projectId = new Types.ObjectId(projectId);
    if (status) filter.status = status;
    const skip = (page - 1) * limit;
    const [assignments, total] = await Promise.all([
      this.programAssignmentModel
        .find(filter)
        .populate(
          'programId',
          'name occurrenceCount intervalValue intervalUnit',
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.programAssignmentModel.countDocuments(filter),
    ]);
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

  async pauseAssignment(
    assignmentId: string,
    adminId: string,
  ): Promise<ProgramAssignment> {
    const assignment = await this.findAssignment(assignmentId, adminId);
    if (assignment.status !== 'running' && assignment.status !== 'scheduled') {
      throw new BadRequestException(
        `Cannot pause assignment in status "${assignment.status}".`,
      );
    }
    assignment.status = 'paused';
    assignment.pausedAt = new Date();
    return assignment.save();
  }

  async resumeAssignment(
    assignmentId: string,
    adminId: string,
  ): Promise<ProgramAssignment> {
    const assignment = await this.findAssignment(assignmentId, adminId);
    if (assignment.status !== 'paused') {
      throw new BadRequestException(
        `Cannot resume assignment in status "${assignment.status}".`,
      );
    }
    assignment.status = 'running';
    assignment.pausedAt = undefined;
    return assignment.save();
  }

  async cancelAssignment(
    assignmentId: string,
    adminId: string,
  ): Promise<ProgramAssignment> {
    const assignment = await this.findAssignment(assignmentId, adminId);
    if (
      assignment.status === 'completed' ||
      assignment.status === 'cancelled'
    ) {
      throw new BadRequestException(
        `Assignment is already ${assignment.status}.`,
      );
    }
    assignment.status = 'cancelled';
    return assignment.save();
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
        { $set: { status: 'paused', pausedAt: new Date() } },
      )
      .exec();
  }

  async markAssignmentCompleted(assignmentId: Types.ObjectId): Promise<void> {
    await this.programAssignmentModel
      .updateOne(
        { _id: assignmentId },
        { $set: { status: 'completed', completedAt: new Date() } },
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
        { status: 'scheduled', startAt: { $lte: now } },
        { $set: { status: 'running' } },
      )
      .exec();
    return this.programAssignmentModel
      .find({
        status: 'running',
        failureCount: { $lt: 3 },
      })
      .populate('programId')
      .exec() as Promise<ProgramAssignmentDocument[]>;
  }
}
