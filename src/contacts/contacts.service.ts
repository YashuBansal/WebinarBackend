import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Contact, ContactDocument } from './Contact.schema';
import {
  CreateContactDto,
  UpdateContactDto,
  BulkCreateContactsDto,
  CSVImportDto,
  PaginationQueryDto,
  ContactFiltersDto,
} from './dto/contacts.dto';

@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(
    @InjectModel(Contact.name)
    private readonly contactModel: Model<ContactDocument>,
  ) {}

  async create(
    createContactDto: CreateContactDto,
    adminId: Types.ObjectId,
  ): Promise<Contact> {
    const { email, phone, projectId } = createContactDto;

    // Check if contact already exists with same email or phone for this admin
    const existingContact = await this.contactModel.findOne({
      adminId,
      $or: [{ email }, { phone }],
      isDeleted: false,
    });

    if (existingContact) {
      throw new ConflictException(
        'Contact with this email or phone already exists',
      );
    }

    const newContact = await this.contactModel.create({
      ...createContactDto,
      projectId: new Types.ObjectId(projectId),
      adminId,
    });

    return newContact;
  }

  async bulkCreate(
    bulkCreateContactsDto: BulkCreateContactsDto,
    adminId: Types.ObjectId,
  ) {
    const { contacts, defaultCountryCode, replaceTags } = bulkCreateContactsDto;

    try {
      // Normalize phone numbers with country code if provided
      const normalizedContacts = contacts.map(contact => ({
        ...contact,
        phone: this.normalizePhoneNumber(contact.phone, defaultCountryCode),
      }));

      // Get all phone numbers for duplicate checking (phone is unique per project)
      const phones = normalizedContacts.map((c) => c.phone);
      const projectId = new Types.ObjectId(normalizedContacts[0]?.projectId);

      // Find existing contacts by phone (phone is unique per project)
      const existingContacts = await this.contactModel
        .find({
          adminId,
          projectId,
          phone: { $in: phones },
          isDeleted: false,
        })
        .exec();

      const existingPhonesMap = new Map(
        existingContacts.map((c) => [c.phone, c])
      );

      const results = {
        created: [],
        updated: [],
        failed: [],
        skipped: [],
      };

      for (const contactData of normalizedContacts) {
        try {
          const existingContact = existingPhonesMap.get(contactData.phone);

          if (existingContact) {
            // Contact exists - update it
            const updateData: any = {};

            // Update firstName, lastName, email if provided
            if (contactData.firstName) updateData.firstName = contactData.firstName;
            if (contactData.lastName) updateData.lastName = contactData.lastName;
            if (contactData.email) updateData.email = contactData.email;

            // Handle tags based on replaceTags flag
            if (contactData.tags && contactData.tags.length > 0) {
              if (replaceTags) {
                updateData.tags = contactData.tags;
              } else {
                // Merge tags, removing duplicates
                const existingTags = existingContact.tags || [];
                const newTags = contactData.tags || [];
                const mergedTags = [...new Set([...existingTags, ...newTags])];
                updateData.tags = mergedTags;
              }
            }

            const updatedContact = await this.contactModel
              .findByIdAndUpdate(
                existingContact._id,
                { $set: updateData },
                { new: true }
              )
              .exec();

            results.updated.push(updatedContact);
          } else {
            // New contact - create it
            const newContact = await this.contactModel.create({
              ...contactData,
              projectId: new Types.ObjectId(contactData.projectId),
              adminId,
              isActive: true,
              isDeleted: false,
            });

            results.created.push(newContact);
          }
        } catch (error) {
          results.failed.push({
            contact: contactData,
            error: error.message,
          });
        }
      }

      return results;
    } catch (error) {
      this.logger.error('Bulk create failed:', error);
      throw error;
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
      if (filters.search) {
        filter.$or = [
          { firstName: { $regex: filters.search, $options: 'i' } },
          { lastName: { $regex: filters.search, $options: 'i' } },
          { email: { $regex: filters.search, $options: 'i' } },
          { phone: { $regex: filters.search, $options: 'i' } },
        ];
      }

      if (filters.tags && filters.tags.length > 0) {
        filter.tags = { $in: filters.tags };
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

  async bulkRemove(
    adminId: Types.ObjectId,
    contactIds: Types.ObjectId[],
  ): Promise<{ deleted: Contact[]; failed: any[] }> {
    console.log('contactIds', contactIds, adminId);

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
}
