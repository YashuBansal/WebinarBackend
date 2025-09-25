import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { BillingHistory, BillingType } from 'src/schemas/BillingHistory.schema';
import {
  BillingHistoryDto,
  GetBillingHistoryDto,
  UpdateBillingHistory,
} from './dto/bililngHistory.dto';
import { Counter } from 'src/schemas/counter.schema';

@Injectable()
export class BillingHistoryService {
  private readonly INVOICE_PREFIX = 'WLH';
  private readonly INVOICE_COUNTER_ID = 'invoiceNumber';

  constructor(
    @InjectModel(BillingHistory.name)
    private BillingHistoryModel: Model<BillingHistory>,
    @InjectModel(Counter.name)
    private readonly counterModel: Model<Counter>,
  ) {}

  private async generateNextInvoiceNumber(): Promise<string> {
    // FIX: Use findOneAndUpdate and query by the 'name' field
    const counter = await this.counterModel.findOneAndUpdate(
      { name: this.INVOICE_COUNTER_ID }, // Query object
      { $inc: { sequence_value: 1 } }, // Update
      { new: true, upsert: true }, // Options
    );

    const sequenceString = counter.sequence_value.toString().padStart(6, '0');

    return `${this.INVOICE_PREFIX}${sequenceString}`;
  }

  private async isInvoiceNumberUnique(invoiceNumber: string): Promise<boolean> {
    const existing = await this.BillingHistoryModel.findOne({ invoiceNumber });
    return !existing;
  }

  async addBillingHistory(
    billingHistoryDto: BillingHistoryDto,
    billingType: BillingType,
  ): Promise<any> {
    const invoiceNumber = await this.generateNextInvoiceNumber();

    const result = await this.BillingHistoryModel.create({
      ...billingHistoryDto,
      invoiceNumber,
      billingType,
      itemAmount: parseFloat(billingHistoryDto.itemAmount.toFixed(2)),
      discountAmount: parseFloat(billingHistoryDto.discountAmount.toFixed(2)),
      taxAmount: parseFloat(billingHistoryDto.taxAmount.toFixed(2)),
      amount: parseFloat(billingHistoryDto.amount.toFixed(2)),
    });
    return result;
  }

  async updateBillingHistory(
    id: string,
    updateBillingHistory: UpdateBillingHistory,
  ): Promise<any> {
    const result =
      this.BillingHistoryModel.findByIdAndUpdate(updateBillingHistory);
  }

  async addOneBillingHistory(
    adminId: string,
    addOnId: string,
    itemAmount: number,
    taxAmount: number,
    totalAmount: number,
    taxPercent: number,
  ): Promise<BillingHistory> {
    const invoiceNumber = await this.generateNextInvoiceNumber();

    const billingHistory = new this.BillingHistoryModel({
      admin: new Types.ObjectId(`${adminId}`),
      date: new Date(),
      addOn: new Types.ObjectId(`${addOnId}`),
      billingType: BillingType.ADD_ON,
      amount: parseFloat(totalAmount.toFixed(2)),
      itemAmount: parseFloat(itemAmount.toFixed(2)),
      taxAmount: parseFloat(taxAmount.toFixed(2)),
      taxPercent: taxPercent,
      invoiceNumber,
    });
    return billingHistory.save();
  }

  async getBillingHistory(queryDto: GetBillingHistoryDto): Promise<{
    page: number;
    limit: number;
    totalPages: number;
    totalRecords: number;
    data: BillingHistory[];
  }> {
    const { page, limit, adminId, startDate, endDate } = queryDto;
    console.log(queryDto);

    // 1. Build the dynamic filter query object
    const filter: FilterQuery<BillingHistory> = {};

    // Conditionally add adminId to the filter
    if (adminId) {
      if (!Types.ObjectId.isValid(adminId)) {
        throw new BadRequestException('Invalid adminId format.');
      }
      filter.admin = new Types.ObjectId(adminId);
    }

    // Conditionally add the date range to the filter
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) {
        // Set to the beginning of the start day
        const start = new Date(startDate);
        filter.date.$gte = start;
        console.log('state - ', start);
      }
      if (endDate) {
        // Set to the end of the end day for an inclusive search
        const end = new Date(endDate);
        filter.date.$lte = end;
        console.log('state - ', end);
      }
    }

    const skip = (page - 1) * limit;

    // 2. Execute find and count queries in parallel for efficiency
    const [data, totalRecords] = await Promise.all([
      this.BillingHistoryModel.find(filter)
        .populate({
          path: 'addOn',
          select: 'addonName _id',
        })
        .populate({
          path: 'plan',
          select: 'name _id',
        })
        .populate({
          path: 'admin',
          select: 'userName _id email',
        })
        .sort({ date: -1 })
        .skip(skip)
        .limit(limit)
        .exec(), // .exec() is good practice with Promise.all
      this.BillingHistoryModel.countDocuments(filter).exec(),
    ]);

    // 3. Calculate total pages and format the response
    const totalPages = Math.ceil(totalRecords / limit);

    return {
      totalPages,
      data: data || [],
      page,
      limit,
      totalRecords,
    };
  }
}
