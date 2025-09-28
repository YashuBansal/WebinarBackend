import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Contact, ContactDocument } from 'src/schemas/Contact.schema';
import {
  CreateContactDto,
  UpdateContactDto,
  BulkCreateContactsDto,
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
    const { contacts } = bulkCreateContactsDto;

    try {
      // First, check for existing contacts to avoid duplicates
      const emails = contacts.map((c) => c.email);
      const phones = contacts.map((c) => c.phone);

      const existingContacts = await this.contactModel
        .find({
          adminId,
          $or: [{ email: { $in: emails } }, { phone: { $in: phones } }],
          isDeleted: false,
        })
        .exec();

      const existingEmails = new Set(existingContacts.map((c) => c.email));
      const existingPhones = new Set(existingContacts.map((c) => c.phone));

      // Separate contacts into valid and invalid
      const validContacts = [];
      const failed = [];

      contacts.forEach((contactData) => {
        if (
          existingEmails.has(contactData.email) ||
          existingPhones.has(contactData.phone)
        ) {
          failed.push({
            contact: contactData,
            error: 'Contact with this email or phone already exists',
          });
        } else {
          validContacts.push({
            ...contactData,
            projectId: new Types.ObjectId(contactData.projectId),
            adminId,
            isActive: true,
            isDeleted: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
      });

      // Use insertMany for valid contacts
      const created =
        validContacts.length > 0
          ? await this.contactModel.insertMany(validContacts)
          : [];

      return { created, failed };
    } catch (error) {
      // If insertMany fails, add all contacts to failed
      const failed = contacts.map((contactData) => ({
        contact: contactData,
        error: error.message,
      }));

      return { created: [], failed };
    }
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
