import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Delete,
  Query,
  ValidationPipe,
} from '@nestjs/common';
import { ContactsService } from './contacts.service';
import {
  CreateContactDto,
  UpdateContactDto,
  BulkCreateContactsDto,
  BulkUpdateContactTagsDto,
  PaginationQueryDto,
  ContactFiltersDto,
  ImportHistoryQueryDto,
} from './dto/contacts.dto';
import { Id } from 'src/decorators/custom.decorator';
import { Types } from 'mongoose';

@Controller('contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Post()
  async create(
    @Body() createContactDto: CreateContactDto,
    @Id() adminId: string,
  ) {
    return this.contactsService.create(
      createContactDto,
      new Types.ObjectId(adminId),
    );
  }

  @Post('bulk')
  async bulkCreate(
    @Body() bulkCreateContactsDto: BulkCreateContactsDto,
    @Id() adminId: string,
  ) {
    return this.contactsService.bulkCreate(
      bulkCreateContactsDto,
      new Types.ObjectId(adminId),
    );
  }

  @Get('import-history')
  async getImportHistory(
    @Id() adminId: string,
    @Query(
      new ValidationPipe({
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    )
    query: ImportHistoryQueryDto,
  ) {
    return this.contactsService.getImportHistory(
      new Types.ObjectId(adminId),
      query,
    );
  }

  @Get('import-history/:id')
  async getImportHistoryById(
    @Id() adminId: string,
    @Param('id') importHistoryId: string,
  ) {
    return this.contactsService.getImportHistoryById(
      new Types.ObjectId(adminId),
      new Types.ObjectId(importHistoryId),
    );
  }

  @Get()
  async findAll(
    @Id() adminId: string,
    @Query(
      new ValidationPipe({
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    )
    paginationQuery: PaginationQueryDto,
    @Query(
      new ValidationPipe({
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    )
    filters: ContactFiltersDto,
  ) {
    return this.contactsService.findAll(
      new Types.ObjectId(adminId),
      paginationQuery,
      filters,
    );
  }

  @Get('stats')
  async getStats(@Id() adminId: string) {
    return this.contactsService.getContactStats(new Types.ObjectId(adminId));
  }

  @Get('project/:projectId')
  async getContactsByProject(
    @Id() adminId: string,
    @Param('projectId') projectId: string,
    @Query(
      new ValidationPipe({
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    )
    paginationQuery: PaginationQueryDto,
  ) {
    return this.contactsService.getContactsByProject(
      new Types.ObjectId(adminId),
      new Types.ObjectId(projectId),
      paginationQuery,
    );
  }

  @Get(':id')
  async findOne(@Id() adminId: string, @Param('id') contactId: string) {
    return this.contactsService.findOne(
      new Types.ObjectId(adminId),
      new Types.ObjectId(contactId),
    );
  }

  @Patch('bulk/tags')
  async bulkUpdateTags(
    @Id() adminId: string,
    @Body() bulkUpdateContactTagsDto: BulkUpdateContactTagsDto,
  ) {
    return this.contactsService.bulkUpdateTags(
      new Types.ObjectId(adminId),
      bulkUpdateContactTagsDto,
    );
  }

  @Patch(':id')
  async update(
    @Id() adminId: string,
    @Param('id') contactId: string,
    @Body() updateContactDto: UpdateContactDto,
  ) {
    return this.contactsService.update(
      new Types.ObjectId(adminId),
      new Types.ObjectId(contactId),
      updateContactDto,
    );
  }

  @Delete('bulk')
  async bulkRemove(
    @Id() adminId: string,
    @Body() bulkDeleteDto: { contactIds: string[] },
  ) {
    return this.contactsService.bulkRemove(
      new Types.ObjectId(`${adminId}`),
      bulkDeleteDto.contactIds.map((id) => new Types.ObjectId(id)),
    );
  }

  @Delete(':id')
  async remove(@Id() adminId: string, @Param('id') contactId: string) {
    return this.contactsService.remove(
      new Types.ObjectId(adminId),
      new Types.ObjectId(contactId),
    );
  }
}
