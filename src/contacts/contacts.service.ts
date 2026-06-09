import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  Inject,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Queue } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Contact, ContactDocument } from './Contact.schema';
import {
  CreateContactDto,
  UpdateContactDto,
  BulkCreateContactsDto,
  BulkUpdateContactTagsDto,
  PaginationQueryDto,
  ContactFiltersDto,
  ImportHistoryQueryDto,
} from './dto/contacts.dto';
import { WabaTagsService } from 'src/waba-tags/waba-tags.service';
import {
  ContactImportHistory,
  ContactImportHistoryDocument,
  ContactImportStatus,
} from './ContactImportHistory.schema';
import { CONTACTS_IMPORT_QUEUE } from './contacts-import.queue.module';

@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(
    @InjectModel(Contact.name)
    private readonly contactModel: Model<ContactDocument>,
    @InjectModel(ContactImportHistory.name)
    private readonly contactImportHistoryModel: Model<ContactImportHistoryDocument>,
    @Inject(CONTACTS_IMPORT_QUEUE)
    private readonly contactsImportQueue: Queue,
    private readonly wabaTagsService: WabaTagsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(
    createContactDto: CreateContactDto,
    adminId: Types.ObjectId,
  ): Promise<Contact> {
    const { phone, projectId } = createContactDto;
    const normalizedTags = this.normalizeTags(createContactDto.tags);

    // Check if contact already exists with same email or phone for this admin
    const existingContact = await this.contactModel.findOne({
      adminId,
      phone,
      isDeleted: false,
    });

    if (existingContact) {
      throw new ConflictException('Contact with this phone already exists');
    }

    const newContact = await this.contactModel.create({
      ...createContactDto,
      crmTags: normalizedTags,
      projectId: new Types.ObjectId(projectId),
      adminId,
    });

    await this.wabaTagsService.ensureTagsExist(
      new Types.ObjectId(projectId),
      adminId,
      normalizedTags,
    );

    // Emit internal event for CRM automation builder
    try {
      this.eventEmitter.emit('automation.trigger', {
        eventType: 'lead_created',
        projectId: String(projectId),
        data: newContact,
      });
    } catch (err) {
      this.logger.error('Failed to emit lead_created event:', err);
    }

    return newContact;
  }

  async bulkCreate(
    bulkCreateContactsDto: BulkCreateContactsDto,
    adminId: Types.ObjectId,
  ) {
    const { contacts, sourceType, fileName } = bulkCreateContactsDto;
    const declaredTotalRows =
      typeof bulkCreateContactsDto.totalRows === 'number'
        ? bulkCreateContactsDto.totalRows
        : contacts?.length || 0;

    if (!contacts || contacts.length === 0) {
      throw new ConflictException('No contacts provided for import');
    }

    const firstProjectId = contacts[0]?.projectId;
    if (!firstProjectId) {
      throw new ConflictException('Project is required for import');
    }

    const mixedProject = contacts.some((contact) => contact.projectId !== firstProjectId);
    if (mixedProject) {
      throw new ConflictException('All imported rows must belong to same project');
    }

    const historyRecord = await this.contactImportHistoryModel.create({
      adminId,
      projectId: new Types.ObjectId(firstProjectId),
      sourceType: sourceType || 'unknown',
      fileName: fileName || '',
      status: 'queued',
      totalRows: declaredTotalRows,
      startedAt: new Date(),
      importPayload: {
        ...bulkCreateContactsDto,
        contacts,
      },
    });

    const queuedJob = await this.contactsImportQueue.add('contacts-bulk-import', {
      importHistoryId: historyRecord._id.toString(),
    });

    await this.contactImportHistoryModel.findByIdAndUpdate(historyRecord._id, {
      $set: {
        queueJobId: queuedJob.id?.toString() || '',
      },
    });

    return {
      importHistoryId: historyRecord._id,
      jobId: queuedJob.id,
      status: 'queued',
      message: 'Import queued successfully',
    };
  }

  async processBulkImportJob(importHistoryId: string): Promise<void> {
    const historyRecord = await this.contactImportHistoryModel.findById(importHistoryId);
    if (!historyRecord) {
      this.logger.warn(`Import history ${importHistoryId} not found`);
      return;
    }
    if (!historyRecord.importPayload?.contacts?.length) {
      await this.finalizeImportHistory(
        historyRecord._id as Types.ObjectId,
        'failed',
        {
          totalRows: historyRecord.totalRows || 0,
          validRows: 0,
          invalidRows: historyRecord.totalRows || 0,
          duplicates: 0,
          newCount: 0,
          updatedCount: 0,
          failedCount: historyRecord.totalRows || 0,
          failureReason: 'Missing import payload',
        },
      );
      return;
    }

    await this.contactImportHistoryModel.findByIdAndUpdate(historyRecord._id, {
      $set: { status: 'processing' },
    });

    const payload = historyRecord.importPayload;
    const contacts = payload.contacts || [];
    const totalRows = payload.totalRows || contacts.length;
    const projectId = new Types.ObjectId(`${historyRecord.projectId}`);
    const adminId = new Types.ObjectId(`${historyRecord.adminId}`);

    const chunkSize = Number(process.env.CONTACTS_IMPORT_CHUNK_SIZE || 1000);
    let validRows = 0;
    let invalidRows = payload.clientInvalidRows || 0;
    let duplicates = 0;
    let newCount = 0;
    let updatedCount = 0;
    let failedCount = 0;
    let processedRows = payload.clientInvalidRows || 0;
    const invalidRecordsSample: Array<{
      rowNumber: number;
      phoneRaw?: string;
      reason: string;
      sourceRow?: Record<string, unknown>;
    }> = (payload.clientInvalidRecordsSample || []).slice(0, 100);
    const seenPhones = new Set<string>();

    try {
      for (let start = 0; start < contacts.length; start += chunkSize) {
      const chunk = contacts.slice(start, start + chunkSize);
      const chunkPrepared: Array<{ rowNumber: number; data: any }> = [];
      const chunkPhones: string[] = [];

      for (let i = 0; i < chunk.length; i++) {
        const rowNumber = start + i + 1;
        const row = chunk[i];
        const normalizedPhone = this.normalizePhoneNumber(
          row.phone,
          payload.defaultCountryCode,
        );

        if (!normalizedPhone) {
          invalidRows++;
          if (invalidRecordsSample.length < 100) {
            invalidRecordsSample.push({
              rowNumber,
              phoneRaw: row.phone,
              reason: 'Invalid or empty phone',
              sourceRow: this.sanitizeSourceRow(row),
            });
          }
          continue;
        }

        if (seenPhones.has(normalizedPhone)) {
          duplicates++;
        }
        seenPhones.add(normalizedPhone);
        validRows++;
        const prepared = {
          ...row,
          phone: normalizedPhone,
          crmTags: this.normalizeTags(row.tags),
        };
        chunkPrepared.push({ rowNumber, data: prepared });
        chunkPhones.push(normalizedPhone);
      }

      const existingContacts = await this.contactModel
        .find({
          adminId,
          projectId,
          phone: { $in: chunkPhones },
          isDeleted: false,
        })
        .exec();
      const existingMap = new Map(existingContacts.map((c) => [c.phone, c]));

      const importTags = chunkPrepared.flatMap((item) => item.data.crmTags || []);
      await this.wabaTagsService.ensureTagsExist(projectId, adminId, importTags);

      const operations = chunkPrepared.map(({ data }) => {
        const existing = existingMap.get(data.phone);
        if (!existing) {
          newCount++;
          return {
            updateOne: {
              filter: {
                adminId,
                projectId,
                phone: data.phone,
                isDeleted: false,
              },
              update: {
                $setOnInsert: {
                  ...data,
                  adminId,
                  projectId,
                  isActive: true,
                  isDeleted: false,
                },
              },
              upsert: true,
            },
          };
        }

        const updateData: any = {};
        if (data.firstName) updateData.firstName = data.firstName;
        if (data.lastName) updateData.lastName = data.lastName;
        if (data.email) updateData.email = data.email;
        if (data.crmTags && data.crmTags.length > 0) {
          if (payload.replaceTags) {
            updateData.crmTags = data.crmTags;
          } else {
            const existingTags = this.normalizeTags(existing.crmTags || []);
            updateData.crmTags = [...new Set([...existingTags, ...data.crmTags])];
          }
        }
        if (Object.keys(updateData).length === 0) {
          return null;
        }
        updatedCount++;
        return {
          updateOne: {
            filter: { _id: existing._id },
            update: { $set: updateData },
          },
        };
      }).filter(Boolean);

      if (operations.length > 0) {
        try {
          await this.contactModel.bulkWrite(operations as any[], { ordered: false });
        } catch (bulkError) {
          failedCount += operations.length;
          this.logger.error(
            `Bulk write chunk failed for import ${importHistoryId}: ${bulkError.message}`,
          );
          if (invalidRecordsSample.length < 100) {
            invalidRecordsSample.push({
              rowNumber: start + 1,
              reason: `Chunk write failure: ${bulkError.message}`,
            });
          }
        }
      }

      processedRows = Math.min(
        (payload.clientInvalidRows || 0) + start + chunk.length,
        totalRows,
      );
      await this.contactImportHistoryModel.findByIdAndUpdate(historyRecord._id, {
        $set: {
          processedRows,
          validRows,
          invalidRows,
          duplicates,
          newCount,
          updatedCount,
          failedCount,
          invalidRecordsSample,
        },
      });
      }

      const summary = this.buildImportSummary({
        totalRows,
        validRows,
        invalidRows,
        duplicates,
        newCount,
        updatedCount,
        failedCount,
      });

      await this.finalizeImportHistory(
        historyRecord._id as Types.ObjectId,
        summary.status,
        {
          ...summary,
          failureReason: summary.failureReason,
        },
      );
    } catch (error) {
      this.logger.error(
        `Import job ${importHistoryId} crashed: ${error.message}`,
        error.stack,
      );
      await this.finalizeImportHistory(historyRecord._id as Types.ObjectId, 'failed', {
        totalRows,
        validRows,
        invalidRows: Math.max(invalidRows, totalRows - validRows),
        duplicates,
        newCount,
        updatedCount,
        failedCount: Math.max(failedCount, 1),
        failureReason: error.message || 'Import processor failed unexpectedly',
      });
      throw error;
    }
  }

  private buildImportSummary(input: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
    duplicates: number;
    newCount: number;
    updatedCount: number;
    failedCount: number;
  }): {
    totalRows: number;
    validRows: number;
    invalidRows: number;
    duplicates: number;
    newCount: number;
    updatedCount: number;
    failedCount: number;
    status: ContactImportStatus;
    failureReason: string;
  } {
    const summary = {
      ...input,
      status: 'success' as ContactImportStatus,
      failureReason: '',
    };

    const processedCount = input.newCount + input.updatedCount;
    if (processedCount === 0 && input.totalRows > 0) {
      summary.status = 'failed';
      summary.failureReason = 'No rows were processed';
      return summary;
    }

    if (input.failedCount > 0 || input.invalidRows > 0) {
      summary.status = 'partial_success';
      summary.failureReason = this.buildPartialFailureReason(input);
    }

    return summary;
  }

  private buildPartialFailureReason(input: {
    invalidRows: number;
    failedCount: number;
  }): string {
    const reasonParts: string[] = [];
    if (input.invalidRows > 0) {
      reasonParts.push(`${input.invalidRows} invalid row(s)`);
    }
    if (input.failedCount > 0) {
      reasonParts.push(`${input.failedCount} row(s) failed while writing`);
    }
    return reasonParts.join('; ');
  }

  private async finalizeImportHistory(
    historyId: Types.ObjectId,
    status: ContactImportStatus,
    summary: {
      totalRows: number;
      validRows: number;
      invalidRows: number;
      duplicates: number;
      newCount: number;
      updatedCount: number;
      failedCount: number;
      failureReason?: string;
    },
  ): Promise<void> {
    try {
      await this.contactImportHistoryModel.findByIdAndUpdate(historyId, {
        $set: {
          status,
          totalRows: summary.totalRows,
          validRows: summary.validRows,
          invalidRows: summary.invalidRows,
          duplicates: summary.duplicates,
          newCount: summary.newCount,
          updatedCount: summary.updatedCount,
          failedCount: summary.failedCount,
          processedRows: summary.totalRows,
          completedAt: new Date(),
          failureReason: summary.failureReason || '',
        },
        $unset: {
          importPayload: 1,
        },
      });
    } catch (historyError) {
      this.logger.error(
        `Failed to finalize import history ${historyId.toString()}: ${historyError.message}`,
      );
    }
  }

  /**
   * Normalize phone number based on country code
   */
  private normalizePhoneNumber(phone: string, countryCode?: string): string {
    if (!phone) return '';

    // Convert to string first to handle all input types
    let phoneStr = String(phone).trim();

    // Handle scientific notation (e.g., "1.234E+10", "1.234e+10")
    if (phoneStr.includes('E') || phoneStr.includes('e')) {
      try {
        // Convert scientific notation to number, then to fixed decimal string
        const num = Number(phoneStr);
        if (!isNaN(num)) {
          // Use toFixed(0) to remove decimal places, then convert back to string
          phoneStr = num.toFixed(0);
        }
      } catch (error) {
        this.logger.warn('Error converting scientific notation:', error);
        return '';
      }
    }

    // Remove all non-numeric characters
    const cleanedPhone = phoneStr.replace(/[^0-9]/g, '');

    // Handle different country codes
    if (countryCode === 'IN' || countryCode === '+91') {
      // India: 10-digit numbers
      if (cleanedPhone.length > 10) {
        // Get last 10 digits and prepend 91
        const last10Digits = cleanedPhone.slice(-10);
        return `91${last10Digits}`;
      } else if (cleanedPhone.length === 10) {
        // Prepend 91 for 10-digit numbers
        return `91${cleanedPhone}`;
      }
    } else if (countryCode === 'US' || countryCode === '+1') {
      // US: 10-digit numbers
      if (cleanedPhone.length > 10) {
        const last10Digits = cleanedPhone.slice(-10);
        return `1${last10Digits}`;
      } else if (cleanedPhone.length === 10) {
        return `1${cleanedPhone}`;
      }
    } else if (countryCode === 'GB' || countryCode === '+44') {
      // UK: 10-digit numbers
      if (cleanedPhone.length > 10) {
        const last10Digits = cleanedPhone.slice(-10);
        return `44${last10Digits}`;
      } else if (cleanedPhone.length === 10) {
        return `44${cleanedPhone}`;
      }
    } else if (countryCode === 'CA' || countryCode === '+1') {
      // Canada: 10-digit numbers (same as US)
      if (cleanedPhone.length > 10) {
        const last10Digits = cleanedPhone.slice(-10);
        return `1${last10Digits}`;
      } else if (cleanedPhone.length === 10) {
        return `1${cleanedPhone}`;
      }
    } else if (countryCode === 'AU' || countryCode === '+61') {
      // Australia: 9-digit numbers
      if (cleanedPhone.length > 9) {
        const last9Digits = cleanedPhone.slice(-9);
        return `61${last9Digits}`;
      } else if (cleanedPhone.length === 9) {
        return `61${cleanedPhone}`;
      }
    } else if (countryCode === 'DE' || countryCode === '+49') {
      // Germany: 10-digit numbers
      if (cleanedPhone.length > 10) {
        const last10Digits = cleanedPhone.slice(-10);
        return `49${last10Digits}`;
      } else if (cleanedPhone.length === 10) {
        return `49${cleanedPhone}`;
      }
    } else if (countryCode === 'FR' || countryCode === '+33') {
      // France: 9-digit numbers
      if (cleanedPhone.length > 9) {
        const last9Digits = cleanedPhone.slice(-9);
        return `33${last9Digits}`;
      } else if (cleanedPhone.length === 9) {
        return `33${cleanedPhone}`;
      }
    } else if (countryCode === 'BR' || countryCode === '+55') {
      // Brazil: 10-digit numbers
      if (cleanedPhone.length > 10) {
        const last10Digits = cleanedPhone.slice(-10);
        return `55${last10Digits}`;
      } else if (cleanedPhone.length === 10) {
        return `55${cleanedPhone}`;
      }
    } else if (countryCode === 'MX' || countryCode === '+52') {
      // Mexico: 10-digit numbers
      if (cleanedPhone.length > 10) {
        const last10Digits = cleanedPhone.slice(-10);
        return `52${last10Digits}`;
      } else if (cleanedPhone.length === 10) {
        return `52${cleanedPhone}`;
      }
    } else if (countryCode === 'JP' || countryCode === '+81') {
      // Japan: 10-digit numbers
      if (cleanedPhone.length > 10) {
        const last10Digits = cleanedPhone.slice(-10);
        return `81${last10Digits}`;
      } else if (cleanedPhone.length === 10) {
        return `81${cleanedPhone}`;
      }
    } else if (countryCode === 'CN' || countryCode === '+86') {
      // China: 11-digit numbers
      if (cleanedPhone.length > 11) {
        const last11Digits = cleanedPhone.slice(-11);
        return `86${last11Digits}`;
      } else if (cleanedPhone.length === 11) {
        return `86${cleanedPhone}`;
      }
    } else if (countryCode === 'RU' || countryCode === '+7') {
      // Russia: 10-digit numbers
      if (cleanedPhone.length > 10) {
        const last10Digits = cleanedPhone.slice(-10);
        return `7${last10Digits}`;
      } else if (cleanedPhone.length === 10) {
        return `7${cleanedPhone}`;
      }
    }

    // Default: return cleaned phone as is
    return cleanedPhone;
  }

  private normalizeTag(tag: string): string {
    return String(tag).trim().toLowerCase().replace(/\s+/g, '_');
  }

  private sanitizeSourceRow(row: Record<string, unknown>): Record<string, unknown> {
    const safeRow: Record<string, unknown> = {};
    const entries = Object.entries(row || {}).slice(0, 20);
    for (const [key, value] of entries) {
      const safeKey = String(key).slice(0, 80);
      const safeValue =
        typeof value === 'string'
          ? value.slice(0, 300)
          : typeof value === 'number' || typeof value === 'boolean'
            ? value
            : value === null || value === undefined
              ? value
              : String(value).slice(0, 300);
      safeRow[safeKey] = safeValue;
    }
    return safeRow;
  }

  private normalizeTags(tags?: string[]): string[] {
    if (!Array.isArray(tags)) return [];
    return tags.map((tag) => this.normalizeTag(tag)).filter(Boolean);
  }

  async getImportHistory(
    adminId: Types.ObjectId,
    query: ImportHistoryQueryDto,
  ): Promise<{
    imports: ContactImportHistory[];
    pagination: {
      page: number;
      limit: number;
      totalCount: number;
      totalPages: number;
      hasNextPage: boolean;
      hasPrevPage: boolean;
    };
  }> {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const filter: any = { adminId };
    if (query.projectId) {
      filter.projectId = new Types.ObjectId(query.projectId);
    }
    if (query.status) {
      filter.status = query.status;
    }

    const totalCount =
      await this.contactImportHistoryModel.countDocuments(filter);
    const imports = await this.contactImportHistoryModel
      .find(filter)
      .select('-importPayload')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();

    const totalPages = Math.ceil(totalCount / limit);
    return {
      imports: imports as ContactImportHistory[],
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    };
  }

  async getImportHistoryById(
    adminId: Types.ObjectId,
    importHistoryId: Types.ObjectId,
  ): Promise<ContactImportHistory> {
    const item = await this.contactImportHistoryModel
      .findOne({
        _id: importHistoryId,
        adminId,
      })
      .select('-importPayload')
      .lean()
      .exec();

    if (!item) {
      throw new NotFoundException('Import history not found');
    }
    return item as ContactImportHistory;
  }

  async findAll(
    adminId: Types.ObjectId,
    paginationOptions: PaginationQueryDto,
    filters?: ContactFiltersDto,
  ) {
    const { page, limit } = paginationOptions;
    const skip = (page - 1) * limit;

    const filter: any = {
      adminId,
      isDeleted: false,
    };

    // Apply filters
    if (filters) {
      const makeRegex = (value: string) => ({
        $regex: value.replace(/[\\.*+?^${}()|[\]\\]/g, '\\$&'),
        $options: 'i',
      });

      if (filters.search) {
        const escapedSearch = makeRegex(filters.search);
        filter.$or = [
          { firstName: escapedSearch },
          { lastName: escapedSearch },
          { email: escapedSearch },
          { phone: escapedSearch },
        ];
      }

      if (filters.firstName) {
        filter.firstName = makeRegex(filters.firstName);
      }

      if (filters.lastName) {
        filter.lastName = makeRegex(filters.lastName);
      }

      if (filters.email) {
        filter.email = makeRegex(filters.email);
      }

      if (filters.phone) {
        filter.phone = makeRegex(filters.phone);
      }

      if (filters.tags && filters.tags.length > 0) {
        if (filters.tagFilterMode === 'not_has_any') {
          filter.crmTags = { $nin: filters.tags };
        } else {
          filter.crmTags = { $in: filters.tags };
        }
      }

      if (filters.isActive !== undefined) {
        filter.isActive = filters.isActive;
      }

      if (filters.projectId) {
        filter.projectId = new Types.ObjectId(filters.projectId);
      }
    }

    // Get total count for pagination
    const totalCount = await this.contactModel.countDocuments(filter);

    // Get paginated results
    const contacts = await this.contactModel
      .find(filter)
      .sort({ _id: -1 })
      .skip(skip)
      .limit(limit)
      .exec();

    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    return {
      contacts,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNextPage,
        hasPrevPage,
      },
    };
  }

  async getContactByIds(adminId: Types.ObjectId, contactIds: Types.ObjectId[]) {
    const contacts = await this.contactModel
      .find({
        _id: { $in: contactIds },
        adminId,
        isDeleted: false,
      })
      .lean()
      .exec();

    return contacts;
  }

  async findOne(
    adminId: Types.ObjectId,
    contactId: Types.ObjectId,
  ): Promise<Contact> {
    const contact = await this.contactModel
      .findOne({ _id: contactId, adminId, isDeleted: false })
      .populate('projectId', 'projectName')
      .exec();

    if (!contact) {
      throw new NotFoundException(`Contact with ID "${contactId}" not found.`);
    }

    return contact;
  }

  /**
   * Find a contact by ID only (used internally by other services)
   * @param contactId The contact ID
   * @returns Promise<Contact>
   */
  async findById(contactId: Types.ObjectId): Promise<Contact> {
    const contact = await this.contactModel
      .findOne({ _id: contactId, isDeleted: false })
      .exec();

    if (!contact) {
      throw new NotFoundException(`Contact with ID "${contactId}" not found.`);
    }

    return contact;
  }

  async update(
    adminId: Types.ObjectId,
    contactId: Types.ObjectId,
    updateContactDto: UpdateContactDto,
  ): Promise<Contact> {
    // Check if contact exists and belongs to admin
    const existingContact = await this.findOne(adminId, contactId);

    // If email or phone is being updated, check for conflicts
    if (updateContactDto.email || updateContactDto.phone) {
      const conflictFilter: any = {
        adminId,
        _id: { $ne: contactId },
        isDeleted: false,
      };

      if (updateContactDto.email || updateContactDto.phone) {
        conflictFilter.$or = [];
        if (updateContactDto.email) {
          conflictFilter.$or.push({ email: updateContactDto.email });
        }
        if (updateContactDto.phone) {
          conflictFilter.$or.push({ phone: updateContactDto.phone });
        }
      }

      const conflictingContact =
        await this.contactModel.findOne(conflictFilter);
      if (conflictingContact) {
        throw new ConflictException(
          'Contact with this email or phone already exists',
        );
      }
    }

    const updatedContact = await this.contactModel
      .findByIdAndUpdate(contactId, { $set: updateContactDto }, { new: true })
      .populate('projectId', 'projectName')
      .exec();

    return updatedContact;
  }

  async remove(
    adminId: Types.ObjectId,
    contactId: Types.ObjectId,
  ): Promise<Contact> {
    const contact = await this.findOne(adminId, contactId);

    // Soft delete by setting isDeleted to true
    const deletedContact = await this.contactModel
      .findByIdAndUpdate(
        contactId,
        { $set: { isDeleted: true } },
        { new: true },
      )
      .exec();

    return deletedContact;
  }

  async getContactsByProject(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    paginationOptions: PaginationQueryDto,
  ) {
    const filters: ContactFiltersDto = {
      projectId: projectId.toString(),
    };

    return this.findAll(adminId, paginationOptions, filters);
  }

  async bulkUpdateTags(
    adminId: Types.ObjectId,
    bulkUpdateContactTagsDto: BulkUpdateContactTagsDto,
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    const projectId = new Types.ObjectId(bulkUpdateContactTagsDto.projectId);
    const contactObjectIds = bulkUpdateContactTagsDto.contactIds.map(
      (id) => new Types.ObjectId(id),
    );
    const normalizedTags = this.normalizeTags(bulkUpdateContactTagsDto.tags);

    if (normalizedTags.length === 0 || contactObjectIds.length === 0) {
      return { matchedCount: 0, modifiedCount: 0 };
    }

    if (bulkUpdateContactTagsDto.operation === 'add') {
      await this.wabaTagsService.ensureTagsExist(
        projectId,
        adminId,
        normalizedTags,
      );
    }

    const query = {
      _id: { $in: contactObjectIds },
      adminId,
      projectId,
      isDeleted: false,
    };

    const update =
      bulkUpdateContactTagsDto.operation === 'add'
        ? { $addToSet: { crmTags: { $each: normalizedTags } } }
        : { $pull: { crmTags: { $in: normalizedTags } } };

    const result = await this.contactModel.updateMany(query, update);

    return {
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    };
  }

  async bulkRemove(
    adminId: Types.ObjectId,
    contactIds: Types.ObjectId[],
  ): Promise<{ deleted: Contact[]; failed: any[] }> {
    try {
      // First, get the contacts that will be deleted for the response
      const contactsToDelete = await this.contactModel
        .find({
          _id: { $in: contactIds },
          adminId,
          isDeleted: false,
        })
        .exec();

      // Use deleteMany for bulk soft delete
      const result = await this.contactModel.updateMany(
        {
          _id: { $in: contactIds },
          adminId,
          isDeleted: false,
        },
        {
          $set: { isDeleted: true },
        },
      );

      // Return the contacts that were successfully deleted
      const deleted = contactsToDelete;
      const failed = [];

      // If some contacts weren't found or already deleted, add them to failed
      if (result.matchedCount < contactIds.length) {
        const deletedIds = contactsToDelete.map((contact) =>
          contact._id.toString(),
        );
        const notFoundIds = contactIds.filter(
          (id) => !deletedIds.includes(id.toString()),
        );

        notFoundIds.forEach((id) => {
          failed.push({
            contactId: id.toString(),
            error: 'Contact not found or already deleted',
          });
        });
      }

      return { deleted, failed };
    } catch (error) {
      // If the entire operation fails, return all as failed
      const failed = contactIds.map((id) => ({
        contactId: id.toString(),
        error: error.message,
      }));

      return { deleted: [], failed };
    }
  }

  async getContactStats(adminId: Types.ObjectId) {
    const totalContacts = await this.contactModel.countDocuments({
      adminId,
      isDeleted: false,
    });

    const activeContacts = await this.contactModel.countDocuments({
      adminId,
      isDeleted: false,
      isActive: true,
    });

    const contactsByProject = await this.contactModel.aggregate([
      { $match: { adminId, isDeleted: false } },
      { $group: { _id: '$projectId', count: { $sum: 1 } } },
      {
        $lookup: {
          from: 'projects',
          localField: '_id',
          foreignField: '_id',
          as: 'project',
        },
      },
      { $unwind: '$project' },
      { $project: { projectName: '$project.projectName', count: 1 } },
    ]);

    return {
      totalContacts,
      activeContacts,
      inactiveContacts: totalContacts - activeContacts,
      contactsByProject,
    };
  }

  async getContactsByIds(
    adminId: Types.ObjectId,
    contactIds: Types.ObjectId[],
  ) {
    return this.contactModel.find({
      _id: { $in: contactIds },
      adminId,
      isDeleted: false,
    });
  }
}
