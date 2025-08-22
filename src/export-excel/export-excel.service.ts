import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model, Types } from 'mongoose';
import { Worker } from 'worker_threads';
import * as path from 'path';
import { GetClientsFilterDto } from 'src/users/dto/filters.dto';
import { UsersService } from 'src/users/users.service';
import {
  AttendeesFilterDto,
  GroupedAttendeesFilterDto,
  GroupedAttendeesSortObject,
  SortOrder,
  WebinarAttendeesSortBy,
  WebinarAttendeesSortObject,
} from 'src/attendees/dto/attendees.dto';
import { AttendeesService } from 'src/attendees/attendees.service';
import { WebinarFilterDTO } from 'src/webinar/dto/webinar-filter.dto';
import { WebinarService } from 'src/webinar/webinar.service';
import { EmployeeFilterDTO } from 'src/users/dto/employee-filter.dto';
import { UserDocuments } from 'src/schemas/user-documents.schema';
import * as fs from 'fs';
import {
  CreateUserDocumentDto,
  UserDocumentResponse,
} from 'src/documents/dto/user-documents.dto';
import { WebsocketGateway } from 'src/websocket/websocket.gateway';
import { CustomLeadTypeService } from 'src/custom-lead-type/custom-lead-type.service';
import { UserActivityService } from 'src/user-activity/user-activity.service';
import { UserActivityFilterDTO } from 'src/user-activity/dto/user-activity.dto';
import { AssignmentService } from 'src/assignment/assignment.service';
import { AssignmentStatus } from 'src/schemas/Assignments.schema';
import { BillingHistoryService } from 'src/billing-history/billing-history.service';
import { ExportBillingHistoryDTO } from 'src/billing-history/dto/bililngHistory.dto';
import { ProductRevenueExportDTO } from 'src/products/dto/product-level.dto';
import { ProductRevenueService } from 'src/product-revenue/product-revenue.service';
import { EnrollmentsService } from 'src/enrollments/enrollments.service';
import { ExportEnrollmentDTO } from 'src/enrollments/dto/enrollment.dto';
@Injectable()
export class ExportExcelService {
  constructor(
    @InjectModel(UserDocuments.name)
    private readonly userDocumentsModel: Model<UserDocuments>,
    private readonly usersService: UsersService,
    private readonly attendeeService: AttendeesService,
    private readonly webinarService: WebinarService,
    private readonly websocketGateway: WebsocketGateway,
    private readonly leadTypeService: CustomLeadTypeService,
    private readonly userActivityService: UserActivityService,
    private readonly assignmentService: AssignmentService,
    private readonly billingService: BillingHistoryService,
    private readonly productRevenueService: ProductRevenueService,
    private readonly enrollService: EnrollmentsService,
  ) {}

  emitProgress(socketId: null | string, value: number) {
    if (socketId) {
      this.websocketGateway.server.to(socketId).emit('import-export', {
        actionType: 'import',
        value: value,
      });
    }
  }

  async createUserDocuments(payload: CreateUserDocumentDto) {
    const userDocument = new this.userDocumentsModel(payload);
    await userDocument.save();
    const socketId = this.websocketGateway.activeUsers.get(`${payload.userId}`);
    if (socketId) {
      this.websocketGateway.server
        .to(socketId)
        .emit('new-download', userDocument);
    }
  }

  async getUserDocuments(userId: string, page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.userDocumentsModel
        .find({ userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      this.userDocumentsModel.countDocuments({ userId }),
    ]);
    const pagination = {
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
    };
    return {
      data,
      pagination,
      success: true,
      message: 'User documents fetched successfully',
    };
  }

  async deleteUserDocument(
    userId: string,
    id: string,
  ): Promise<{ success: boolean; message: string }> {
    const document = await this.userDocumentsModel.findOneAndDelete({
      userId,
      _id: id,
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    if (document.filePath && fs.existsSync(document.filePath)) {
      try {
        fs.unlinkSync(document.filePath);
      } catch (err) {
        console.error(`Error deleting file: ${document.filePath}`, err);
      }
    }

    return {
      success: true,
      message: 'Document and associated file deleted successfully',
    };
  }

  async getUserDocument(userId: string, id: string): Promise<UserDocuments> {
    const userDocument = await this.userDocumentsModel.findOne({
      userId,
      _id: id,
    });
    return userDocument;
  }

  getUserDirectory(userId: string) {
    if (!userId) {
      throw new NotFoundException('User ID is required');
    }
    const userDir = path.join('exports', userId);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }
    return userDir;
  }

  async generateExcel(
    workerData: any,
    workerPath: string,
  ): Promise<UserDocumentResponse> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerPath, { workerData });

      worker.on('message', (message) => {
        if (message.success) {
          resolve(message);
        } else {
          console.error('Worker Error:', message.error);
          reject(new Error(message.error));
        }
      });

      worker.on('error', (err) => {
        console.error('Worker Thread Error:', err);
        reject(err);
      });

      worker.on('exit', (code) => {
        if (code !== 0) {
          console.error(`Worker stopped with exit code ${code}`);
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });
    });
  }

  async generateExcelForClients(
    limit: number,
    columns: string[],
    filterData: GetClientsFilterDto,
    adminId: string,
    fileName: string = `Clients-${Date.now()}.xlsx`,
  ): Promise<UserDocumentResponse> {
    const socketId = this.websocketGateway.activeUsers.get(String(adminId));
    let lastProgress = 0;
    const updateProgress = (current) => {
      if (current - lastProgress >= 5) {
        // 5% increments
        this.emitProgress(socketId, current);
        lastProgress = current;
      }
    };

    updateProgress(10);
    const data = await this.usersService.getClients(
      0,
      limit,
      filterData,
      false,
    );

    const userDir = this.getUserDirectory(adminId);
    const filePath = path.join(userDir, fileName);

    const workerPath = path.resolve(
      __dirname,
      '../workers/generate-excel.worker.js',
    );
    updateProgress(50);

    const fileData = await this.generateExcel(
      {
        data,
        columns: columns.map((col) => ({
          header: col,
          key: col,
          width: 20,
        })),
        filePath,
        isKey: true,
      },
      workerPath,
    );

    updateProgress(80);
    this.createUserDocuments({
      userId: adminId,
      filePath: filePath,
      fileName: fileName,
      fileSize: fileData.fileSize,
      filters: filterData,
    });

    updateProgress(100);
    return fileData;
  }

  async generateExcelForWebinarAttendees(
    limit: number,
    columns: string[],
    filterData: AttendeesFilterDto,
    webinarId: string,
    isAttended: boolean,
    adminId: string,
    optionalData: {
      validCall?: string | undefined;
      assignmentType?: string | undefined;
      sort?: WebinarAttendeesSortObject;
    },
    fileName: string = `webinar-attendees-${Date.now()}.xlsx`,
  ) {
    const { validCall, assignmentType, sort } = optionalData || {};

    const socketId = this.websocketGateway.activeUsers.get(String(adminId));
    let lastProgress = 0;
    const updateProgress = (current) => {
      if (current - lastProgress >= 5) {
        // 5% increments
        this.emitProgress(socketId, current);
        lastProgress = current;
      }
    };

    updateProgress(10);
    const aggregationResult = await this.attendeeService.getAttendees(
      webinarId,
      adminId,
      isAttended,
      1,
      limit,
      {
        filters: filterData,
        validCall: validCall,
        assignmentType: assignmentType,
        sort: sort,
      },

      false,
    );
    const leadTypes = await this.leadTypeService.getLeadTypes(adminId);

    const parsetResult = aggregationResult.map((attendee) => ({
      ...attendee,
      leadType:
        leadTypes.find((lead) => String(lead._id) === String(attendee.leadType))
          ?.label || ' - ',
      tags: Array.isArray(attendee.tags) ? attendee.tags.join(' , ') : ' - ',
      enrollments: Array.isArray(attendee.enrollments)
        ? attendee.enrollments.join(',')
        : ' - ',
    }));

    const userDir = this.getUserDirectory(adminId);
    const filePath = path.join(userDir, fileName);

    const payload = {
      data: parsetResult || [],
      columns: columns.map((col) => ({
        header: col,
        key: col,
        width: 20,
      })),
      filePath,
      isKey: true,
    };
    updateProgress(50);

    const workerPath = path.resolve(
      __dirname,
      '../workers/generate-excel.worker.js',
    );
    const fileData = await this.generateExcel(payload, workerPath);
    updateProgress(80);
    this.createUserDocuments({
      userId: adminId,
      filePath: filePath,
      fileName: fileName,
      fileSize: fileData.fileSize,
      filters: filterData,
    });

    updateProgress(100);
    return fileData;
  }

  async generateExcelForAttendees(
    limit: number,
    columns: string[],
    filterData: GroupedAttendeesFilterDto,
    adminId: string,
    fileName: string = `attendees-${Date.now()}.xlsx`,
    sort?: GroupedAttendeesSortObject,
  ) {
    const socketId = this.websocketGateway.activeUsers.get(String(adminId));
    let lastProgress = 0;
    const updateProgress = (current) => {
      if (current - lastProgress >= 5) {
        // 5% increments
        this.emitProgress(socketId, current);
        lastProgress = current;
      }
    };

    updateProgress(10);
    const aggregationResult =
      await this.attendeeService.fetchGroupedAttendeesForExport(
        new Types.ObjectId(`${adminId}`),
        1,
        limit,
        filterData,
        sort,
      );
    console.log(aggregationResult);
    let parsedData = [];

    if (Array.isArray(aggregationResult?.data)) {
      parsedData = aggregationResult?.data.map((item) => {
        return {
          ...item,
          tags: Array.isArray(item.tags)
            ? item.tags
                .filter((tag) => typeof tag === 'string' && tag.trim() !== '')
                .join(' , ')
            : ' - ',
          sources: Array.isArray(item.sources)
            ? item.sources
                .filter(
                  (source) =>
                    typeof source === 'string' && source.trim() !== '',
                )
                .join(' , ')
            : ' - ',
          locations: Array.isArray(item.locations)
            ? item.locations
                .filter(
                  (location) =>
                    typeof location === 'string' && location.trim() !== '',
                )
                .join(' , ')
            : ' - ',
        };
      });
    }

    const userDir = this.getUserDirectory(adminId);
    const filePath = path.join(userDir, fileName);

    console.log(parsedData)

    const payload = {
      data: parsedData,
      columns: ['fullNames',...columns].map((col) => ({
        header: col,
        key: col,
        width: 20,
      })),
      filePath,
      isKey: true,
    };
    updateProgress(50);

    const workerPath = path.resolve(
      __dirname,
      '../workers/generate-excel.worker.js',
    );
    const fileData = await this.generateExcel(payload, workerPath);
    updateProgress(80);
    this.createUserDocuments({
      userId: adminId,
      filePath: filePath,
      fileName: fileName,
      fileSize: fileData.fileSize,
      filters: filterData,
    });

    updateProgress(100);
    return fileData;
  }

  async generateExcelForEmployeeAssignments(
    limit: number,
    columns: string[],
    filterData: AttendeesFilterDto,
    adminId: string,
    empId: string,
    fileName: string = `Employee_Assignments-${Date.now()}.xlsx`,
    obj: {
      webinarId: string;
      validCall?: string;
      assignmentStatus?: AssignmentStatus;
      sort?: WebinarAttendeesSortObject;
      validCallFlag?: string;
    },
  ) {
    const socketId = this.websocketGateway.activeUsers.get(String(adminId));
    let lastProgress = 0;
    const updateProgress = (current) => {
      if (current - lastProgress >= 5) {
        // 5% increments
        this.emitProgress(socketId, current);
        lastProgress = current;
      }
    };

    updateProgress(10);

    const {
      webinarId = '',
      validCall = '',
      assignmentStatus,
      sort = {
        sortBy: WebinarAttendeesSortBy.EMAIL,
        sortOrder: SortOrder.ASC,
      },
      validCallFlag = 'all',
    } = obj;

    const aggregationResult = await this.assignmentService.getAssignments(
      adminId,
      empId,
      1,
      limit,
      filterData,
      {
        webinarId,
        validCall,
        assignmentStatus,
        sort,
        validCallFlag,
        formatLeadType: true,
      },
    );
    console.log(aggregationResult);

    const userDir = this.getUserDirectory(adminId);
    const filePath = path.join(userDir, fileName);

    const payload = {
      data: aggregationResult?.result || [],
      columns: columns.map((col) => ({
        header: col,
        key: col,
        width: 20,
      })),
      filePath,
      isKey: true,
    };
    updateProgress(50);

    const workerPath = path.resolve(
      __dirname,
      '../workers/generate-excel.worker.js',
    );
    const fileData = await this.generateExcel(payload, workerPath);
    updateProgress(80);
    this.createUserDocuments({
      userId: adminId,
      filePath: filePath,
      fileName: fileName,
      fileSize: fileData.fileSize,
      filters: filterData,
    });

    updateProgress(100);
    return fileData;
  }

  async generateExcelForClientBillingHistory(
    obj: ExportBillingHistoryDTO,
    adminId: string,
  ) {
    const { startDate, endDate, fileName } = obj;
    console.log(fileName);

    const columns = [
      'client',
      'date',
      'plan',
      'itemAmount',
      'discountAmount',
      'durationType',
      'billingType',
      'taxPercent',
      'taxAmount',
      'amount',
      'invoiceNumber',
    ];

    const socketId = this.websocketGateway.activeUsers.get(String(adminId));
    let lastProgress = 0;
    const updateProgress = (current) => {
      if (current - lastProgress >= 5) {
        // 5% increments
        this.emitProgress(socketId, current);
        lastProgress = current;
      }
    };

    updateProgress(10);

    const aggregationResult: any = await this.billingService.getBillingHistory({
      page: 1,
      limit: 1000,
      startDate,
      endDate,
    });

    const userDir = this.getUserDirectory(adminId);
    const filePath = path.join(userDir, fileName);
    const payload = {
      data: Array.isArray(aggregationResult?.data)
        ? aggregationResult?.data.map((item) => ({
            client: item.admin?.userName,
            plan: item.plan?.name,
            date: item.date,
            itemAmount: item.itemAmount,
            discountAmount: item.discountAmount,
            durationType: item.durationType,
            billingType: item.billingType,
            taxPercent: item.taxPercent,
            taxAmount: item.taxAmount,
            amount: item.amount,
            invoiceNumber: item.invoiceNumber,
          }))
        : [],
      columns: columns.map((col) => ({
        header: col,
        key: col,
        width: 20,
      })),
      filePath,
      isKey: true,
    };
    updateProgress(50);
    console.log(payload);

    const workerPath = path.resolve(
      __dirname,
      '../workers/generate-excel.worker.js',
    );
    const fileData = await this.generateExcel(payload, workerPath);
    updateProgress(80);
    this.createUserDocuments({
      userId: adminId,
      filePath: filePath,
      fileName: fileName,
      fileSize: fileData.fileSize,
      filters: {
        startDate,
        endDate,
      },
    });

    updateProgress(100);
    return fileData;
  }

  async generateExcelForProductRevenue(
    obj: ProductRevenueExportDTO,
    adminId: string,
  ) {
    const {
      startDate: startStr,
      endDate: endStr,
      fileName,
      limit,
      uniqueId,
    } = obj;

    let columns = [];
    let arrayData = [];

    const socketId = this.websocketGateway.activeUsers.get(String(adminId));
    let lastProgress = 0;
    const updateProgress = (current) => {
      if (current - lastProgress >= 5) {
        // 5% increments
        this.emitProgress(socketId, current);
        lastProgress = current;
      }
    };
    updateProgress(10);

    if (uniqueId === 'revenue-by-product-level') {
      columns = [
        {
          key: '_id',
          header: 'Level',
        },
        {
          key: 'totalRevenue',
          header: 'Revenue',
        },
        {
          key: 'count',
          header: 'Sales',
        },
      ];

      const { startDate, endDate } = this.productRevenueService.validateDate(
        startStr,
        endStr,
      );

      const result = await this.productRevenueService.getRevenueByLevel(
        adminId,
        startDate,
        endDate,
      );

      if (Array.isArray(result)) {
        arrayData = result;
      }
    } else if (uniqueId === 'webinar-performance') {
      columns = [
        {
          key: 'webinarName',
          header: 'Webinar',
        },
        {
          key: 'totalRevenue',
          header: 'Revenue',
        },
        {
          key: 'totalEnrollments',
          header: 'Enrollments',
        },
      ];
       const { startDate, endDate } = this.productRevenueService.validateDate(
        startStr,
        endStr,
      );

      const result = await this.productRevenueService.getRevenueByWebinar(
        adminId,
        startDate,
        endDate,
        limit,
      );

      if (Array.isArray(result)) {
        arrayData = result;
      }
    } else if (uniqueId === 'top-performing-products') {
      columns = [
        {
          key: 'name',
          header: 'Product',
        },
        {
          key: 'totalRevenue',
          header: 'Revenue',
        },
        {
          key: 'totalSales',
          header: 'Sales',
        },
      ];

      const { startDate, endDate } = this.productRevenueService.validateDate(
        startStr,
        endStr,
      );

      const result = await this.productRevenueService.getTopProducts(
        adminId,
        startDate,
        endDate,
        limit,
      );

      if (Array.isArray(result)) {
        arrayData = result;
      }
    } else if (uniqueId === 'top-customers') {
      columns = [
        {
          key: '_id',
          header: 'Email',
        },
        {
          key: 'totalRevenue',
          header: 'Total Spent',
        },
        {
          key: 'totalPurchases',
          header: 'Purchases',
        },
      ];

      const { startDate, endDate } = this.productRevenueService.validateDate(
        startStr,
        endStr,
      );

      const result = await this.productRevenueService.getTopUsers(
        adminId,
        startDate,
        endDate,
        limit,
      );

      if (Array.isArray(result)) {
        arrayData = result;
      }
    }

    const userDir = this.getUserDirectory(adminId);
    const filePath = path.join(userDir, fileName);
    const payload = {
      data: arrayData,
      columns: columns,
      filePath,
    };
    updateProgress(50);
    console.log(payload);

    const workerPath = path.resolve(
      __dirname,
      '../workers/generate-excel.worker.js',
    );
    const fileData = await this.generateExcel(payload, workerPath);
    updateProgress(80);
    this.createUserDocuments({
      userId: adminId,
      filePath: filePath,
      fileName: fileName,
      fileSize: fileData.fileSize,
      filters: {},
    });

    updateProgress(100);
    return fileData;
  }

  async generateExcelForWebinar(
    limit: number,
    columns: string[],
    filterData: WebinarFilterDTO,
    adminId: string,
    fileName: string = `webinars-${Date.now()}.xlsx`,
  ): Promise<UserDocumentResponse> {
    const socketId = this.websocketGateway.activeUsers.get(String(adminId));
    let lastProgress = 0;
    const updateProgress = (current) => {
      if (current - lastProgress >= 5) {
        // 5% increments
        this.emitProgress(socketId, current);
        lastProgress = current;
      }
    };

    updateProgress(10);

    const aggregationResult = await this.webinarService.getWebinars(
      adminId,
      1,
      limit,
      filterData,
      false,
    );

    updateProgress(50);

    const userDir = this.getUserDirectory(adminId);
    const filePath = path.join(userDir, fileName);

    const payload = {
      data: aggregationResult.result || [],
      columns: columns.map((col) => ({
        header: col,
        key: col,
        width: 20,
      })),
      filePath,
      isKey: true,
    };

    const workerPath = path.resolve(
      __dirname,
      '../workers/generate-excel.worker.js',
    );
    const fileData = await this.generateExcel(payload, workerPath);
    updateProgress(80);
    this.createUserDocuments({
      userId: adminId,
      filePath: filePath,
      fileName: fileName,
      fileSize: fileData.fileSize,
      filters: filterData,
    });

    updateProgress(100);
    return fileData;
  }

  async generateExcelForUserActivities(
    adminId: Types.ObjectId,
    userId: Types.ObjectId,
    limit: number,
    columns: string[],
    filters?: UserActivityFilterDTO,
  ): Promise<UserDocumentResponse> {
    const socketId = this.websocketGateway.activeUsers.get(String(adminId));
    let lastProgress = 0;
    const updateProgress = (current) => {
      if (current - lastProgress >= 5) {
        // 5% increments
        this.emitProgress(socketId, current);
        lastProgress = current;
      }
    };

    updateProgress(10);

    const aggregationResult =
      await this.userActivityService.getUserActivitiesByUser(
        userId,
        1,
        limit,
        filters,
      );

    console.log(aggregationResult.data);
    updateProgress(50);

    const fileName = `UserActivities-${Date.now()}.xlsx`;
    const userDir = this.getUserDirectory(`${adminId}`);
    const filePath = path.join(userDir, fileName);

    const payload = {
      data: aggregationResult.data || [],
      columns: columns.map((col) => ({
        header: col,
        key: col,
        width: 20,
      })),
      filePath,
      isKey: true,
    };

    const workerPath = path.resolve(
      __dirname,
      '../workers/generate-excel.worker.js',
    );
    const fileData = await this.generateExcel(payload, workerPath);
    updateProgress(80);
    this.createUserDocuments({
      userId: `${adminId}`,
      filePath: filePath,
      fileName: fileName,
      fileSize: fileData.fileSize,
      filters: filters,
    });

    updateProgress(100);
    return fileData;
  }

  async generateExcelForEmployees(
    limit: number,
    columns: string[],
    filterData: EmployeeFilterDTO,
    adminId: string,
    fileName: string = `Employees-${Date.now()}.xlsx`,
  ): Promise<UserDocumentResponse> {
    const socketId = this.websocketGateway.activeUsers.get(String(adminId));
    let lastProgress = 0;
    const updateProgress = (current) => {
      if (current - lastProgress >= 5) {
        // 5% increments
        this.emitProgress(socketId, current);
        lastProgress = current;
      }
    };

    updateProgress(10);

    const aggregationResult = await this.usersService.getEmployees(
      adminId,
      1,
      limit,
      filterData,
    );
    updateProgress(50);

    const userDir = this.getUserDirectory(adminId);
    const filePath = path.join(userDir, fileName);

    const payload = {
      data: aggregationResult.result || [],
      columns: columns.map((col) => ({
        header: col,
        key: col,
        width: 20,
      })),
      filePath,
      isKey: true,
    };

    const workerPath = path.resolve(
      __dirname,
      '../workers/generate-excel.worker.js',
    );
    const fileData = await this.generateExcel(payload, workerPath);
    updateProgress(80);
    this.createUserDocuments({
      userId: adminId,
      filePath: filePath,
      fileName: fileName,
      fileSize: fileData.fileSize,
      filters: filterData,
    });

    updateProgress(100);
    return fileData;
  }

  async generateExcelForEnrollments(
    data: ExportEnrollmentDTO,
    adminId: string,
  ): Promise<UserDocumentResponse> {
    const socketId = this.websocketGateway.activeUsers.get(String(adminId));
    let lastProgress = 0;
    const updateProgress = (current) => {
      if (current - lastProgress >= 5) {
        this.emitProgress(socketId, current);
        lastProgress = current;
      }
    };

    updateProgress(10);

    const { webinarId, product, fileName, columns } = data;

    const productId = mongoose.isValidObjectId(product)
      ? new Types.ObjectId(product)
      : undefined;

    const aggregationResult = await this.enrollService.getEnrollment(
      adminId,
      webinarId,
      1,
      1000,
      productId,
    );
    updateProgress(50);

    const userDir = this.getUserDirectory(adminId);
    const filePath = path.join(userDir, fileName);

    let arrayData = [];

    if (Array.isArray(aggregationResult.result)) {
      arrayData = aggregationResult.result.map((item) => ({
        ...item,
        assignedBy: item.assignedBy ? item.assignedBy : 'API',
      }));
    }

    const payload = {
      data: arrayData,
      columns: columns.map((col) => ({
        header: col,
        key: col,
        width: 20,
      })),
      filePath,
      isKey: true,
    };

    const workerPath = path.resolve(
      __dirname,
      '../workers/generate-excel.worker.js',
    );
    const fileData = await this.generateExcel(payload, workerPath);
    updateProgress(80);
    this.createUserDocuments({
      userId: adminId,
      filePath: filePath,
      fileName: fileName,
      fileSize: fileData.fileSize,
      filters: {},
    });

    updateProgress(100);
    return fileData;
  }

  // async generateExcelForClientsOld(limit: number, columns: string[], filterData: GetClientsFilterDto): Promise<string> {
  //   const data = [];

  //   const defaultColumns = [
  //     { header: 'Email', key: 'email', width: 50 },
  //     { header: 'Company Name', key: 'companyName', width: 30 },
  //     { header: 'User Name', key: 'userName', width: 20 },
  //     { header: 'Phone', key: 'phone', width: 15 },
  //     { header: 'Is Active', key: 'isActive', width: 10 },
  //     { header: 'Plan Name', key: 'planName', width: 20 },
  //     { header: 'Plan Start Date', key: 'planStartDate', width: 20 },
  //     { header: 'Plan Expiry', key: 'planExpiry', width: 20 },
  //     { header: 'Contacts Limit', key: 'contactsLimit', width: 15 },
  //     { header: 'Total Employees', key: 'totalEmployees', width: 15 },
  //     { header: 'Employee Sales Count', key: 'employeeSalesCount', width: 15 },
  //     {
  //       header: 'Employee Reminder Count',
  //       key: 'employeeReminderCount',
  //       width: 15,
  //     },
  //     { header: 'Contacts Count', key: 'contactsCount', width: 15 },
  //     { header: "Toggle Limit", key: "toggleLimit", width: 15 },
  //   ];

  //   const selectedColumns = columns.length
  //     ? defaultColumns.filter((col) => columns.includes(col.key))
  //     : defaultColumns;

  //   // Convert selectedColumns into a Set for faster lookups
  //   const columnKeysSet = new Set(selectedColumns.map((col) => col.key));

  //   const matchFilters = {};
  //   if (filterData.email) {
  //     matchFilters['email'] = filterData.email;
  //   }
  //   if (filterData.companyName) {
  //     matchFilters['companyName'] = filterData.companyName;
  //   }
  //   if (filterData.userName) {
  //     matchFilters['userName'] = filterData.userName;
  //   }
  //   if (filterData.phone) {
  //     matchFilters['phone'] = filterData.phone;
  //   }
  //   if (filterData.isActive) {
  //     matchFilters['isActive'] = filterData.isActive;
  //   }

  //   const pipeline: any[] = [
  //     {
  //       $match: {
  //         role: new Types.ObjectId(
  //           `${this.configService.get('appRoles').ADMIN}`,
  //         ),
  //         ...matchFilters,
  //       },
  //     },
  //   ];

  //   if (columnKeysSet.has('planStartDate') || columnKeysSet.has('planExpiry')) {
  //     const subscriptionFilter = {};
  //     if (filterData.planStartDate) {
  //       subscriptionFilter['startDate'] = filterData.planStartDate;
  //     }
  //     if (filterData.planExpiry) {
  //       subscriptionFilter['expiryDate'] = filterData.planExpiry;
  //     }
  //     if (filterData.contactsLimit) {
  //       subscriptionFilter['contactLimit'] = filterData.contactsLimit;
  //     }

  //     pipeline.push(
  //       {
  //         $lookup: {
  //           from: 'subscriptions',
  //           localField: '_id',
  //           foreignField: 'admin',
  //           pipeline: [
  //             {
  //               $match: subscriptionFilter,
  //             },
  //             {
  //               $project: {
  //                 startDate: 1,
  //                 expiryDate: 1,
  //                 contactLimit: 1,
  //               },
  //             },
  //           ],
  //           as: 'subscription',
  //         },
  //       },
  //       {
  //         $unwind: { path: '$subscription', preserveNullAndEmptyArrays: false },
  //       },
  //     );
  //   }

  //   if (columnKeysSet.has('planname')) {
  //     const planFilter = {};
  //     if (filterData.planName) {
  //       planFilter['name'] = filterData.planName;
  //     }

  //     pipeline.push(
  //       {
  //         $lookup: {
  //           from: 'plans',
  //           localField: 'plan',
  //           foreignField: '_id',
  //           pipeline: [
  //             {
  //               $match: planFilter,
  //             },
  //             {
  //               $project: {
  //                 name: 1,
  //               },
  //             },
  //           ],
  //           as: 'plan',
  //         },
  //       },
  //       { $unwind: { path: '$plan', preserveNullAndEmptyArrays: false } },
  //     );
  //   }

  //   if (
  //     ['totalEmployees', 'employeeSalesCount', 'employeeReminderCount'].some(
  //       (key) => columnKeysSet.has(key),
  //     )
  //   ) {
  //     pipeline.push({
  //       $lookup: {
  //         from: 'users',
  //         localField: '_id',
  //         foreignField: 'adminId',
  //         as: 'employees',
  //       },
  //     });
  //   }

  //   pipeline.push({
  //     $addFields: {
  //       planName: '$plan.name',
  //       planStartDate: '$subscription.startDate',
  //       planExpiry: '$subscription.expiryDate',
  //       contactsLimit: '$subscription.contactLimit',
  //       totalEmployees: { $size: '$employees' },
  //       employeeSalesCount: {
  //         $size: {
  //           $filter: {
  //             input: '$employees',
  //             as: 'emp',
  //             cond: {
  //               $eq: [
  //                 '$$emp.role',
  //                 new Types.ObjectId('66b758544892ce3d994745cb'),
  //               ],
  //             },
  //           },
  //         },
  //       },
  //       employeeReminderCount: {
  //         $size: {
  //           $filter: {
  //             input: '$employees',
  //             as: 'emp',
  //             cond: {
  //               $eq: [
  //                 '$$emp.role',
  //                 new Types.ObjectId('66b7585d4892ce3d994745ce'),
  //               ],
  //             },
  //           },
  //         },
  //       },
  //       // ...(columnKeysSet.has('contactsCount')
  //       //   ? { contactsCount: { $ifNull: ['$contactsCount.totalCount', 0] } }
  //       //   : {}),
  //     },
  //   });

  //   const employeeCountFilter = {};
  //   if (filterData.totalEmployees) {
  //     employeeCountFilter['totalEmployees'] = filterData.totalEmployees;
  //   }
  //   if (filterData.employeeSalesCount) {
  //     employeeCountFilter['employeeSalesCount'] = filterData.employeeSalesCount;
  //   }
  //   if (filterData.employeeReminderCount) {
  //     employeeCountFilter['employeeReminderCount'] =
  //       filterData.employeeReminderCount;
  //   }
  //   pipeline.push({
  //     $match: employeeCountFilter,
  //   });

  //   pipeline.push({ $limit: limit });

  //   pipeline.push({
  //     $project: selectedColumns.reduce(
  //       (proj, col) => ({ ...proj, [col.key]: 1 }),
  //       {},
  //     ),
  //   });

  //   const cursor = this.userModel.aggregate(pipeline).cursor();

  //   for await (const doc of cursor) {
  //     data.push(doc);
  //   }

  //   const workerPath = path.resolve(
  //     __dirname,
  //     '../workers/generate-excel.worker.js',
  //   );

  //   return new Promise((resolve, reject) => {
  //     const worker = new Worker(workerPath, {
  //       workerData: { data, columns: selectedColumns },
  //     });

  //     worker.on('message', (message) => {
  //       if (message.success) {
  //         resolve(message.filePath);
  //       } else {
  //         console.error('Worker Error:', message.error);
  //         reject(new Error(message.error));
  //       }
  //     });

  //     worker.on('error', (err) => {
  //       console.error('Worker Thread Error:', err);
  //       reject(err);
  //     });

  //     worker.on('exit', (code) => {
  //       if (code !== 0) {
  //         console.error(`Worker stopped with exit code ${code}`);
  //         reject(new Error(`Worker stopped with exit code ${code}`));
  //       }
  //     });
  //   });
  // }
}
