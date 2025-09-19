import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Contact, ContactDocument } from 'src/schemas/Contact.schema';
import { CreateContactDto, UpdateContactDto, BulkCreateContactsDto, CursorPaginationQueryDto, ContactFiltersDto } from './dto/contacts.dto';

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
      throw new ConflictException('Contact with this email or phone already exists');
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
  ): Promise<{ created: Contact[]; failed: any[] }> {
    const { contacts } = bulkCreateContactsDto;
    const created: Contact[] = [];
    const failed: any[] = [];

    for (const contactData of contacts) {
      try {
        const contact = await this.create(contactData, adminId);
        created.push(contact);
      } catch (error) {
        failed.push({
          contact: contactData,
          error: error.message,
        });
      }
    }

    return { created, failed };
  }

  async findAll(
    adminId: Types.ObjectId,
    paginationOptions: CursorPaginationQueryDto,
    filters?: ContactFiltersDto,
  ) {
    const { cursor, limit } = paginationOptions;
    const filter: any = { 
      adminId, 
      isDeleted: false 
    };

    // Apply filters
    if (filters) {
      if (filters.search) {
        filter.$or = [
          { fullName: { $regex: filters.search, $options: 'i' } },
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

    // Cursor-based pagination
    if (cursor) {
      filter._id = { $lt: new Types.ObjectId(cursor) };
    }

    const results = await this.contactModel
      .find(filter)
      .populate('projectId', 'projectName')
      .sort({ _id: -1 })
      .limit(limit + 1) // Get one extra to check if there are more
      .exec();

    const hasNextPage = results.length > limit;
    const contacts = hasNextPage ? results.slice(0, -1) : results;
    const nextCursor = hasNextPage ? contacts[contacts.length - 1]._id.toString() : null;

    return {
      contacts,
      hasNextPage,
      nextCursor,
      limit,
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

      const conflictingContact = await this.contactModel.findOne(conflictFilter);
      if (conflictingContact) {
        throw new ConflictException('Contact with this email or phone already exists');
      }
    }

    const updatedContact = await this.contactModel
      .findByIdAndUpdate(
        contactId,
        { $set: updateContactDto },
        { new: true }
      )
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
        { new: true }
      )
      .exec();

    return deletedContact;
  }

  async getContactsByProject(
    adminId: Types.ObjectId,
    projectId: Types.ObjectId,
    paginationOptions: CursorPaginationQueryDto,
  ) {
    const filters: ContactFiltersDto = {
      projectId: projectId.toString(),
    };

    return this.findAll(adminId, paginationOptions, filters);
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
      { $lookup: { from: 'projects', localField: '_id', foreignField: '_id', as: 'project' } },
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
