import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document, Types } from 'mongoose';
import { User } from './User.schema';
import { Products } from './Products.schema';

@Schema({ timestamps: true })
export class Webinar extends Document {
  @Prop({
    type: String,
    required: [true, 'Webinar name is required.'],
  })
  webinarName: string; // Webinar Name

  @Prop({
    type: String,
    required: false,
  })
  meetingId?: string;

  @Prop({
    type: String,
    required: false,
  })
  occurrenceId?: string;

  @Prop({
    type: Date,
    required: false,
  })
  webinarDate: string; // Webinar Date

  @Prop({
    type: Types.ObjectId,
    ref: User.name,
    required: [true, 'Admin Id is required'],
  })
  adminId: Types.ObjectId;

  @Prop({
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: User.name }],
    required: false,
  })
  assignedEmployees: Types.ObjectId[];

  @Prop({
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: User.name }],
    default: [],
  })
  excludedEmployees: Types.ObjectId[];

  @Prop({
    type: Boolean,
    default: false,
  })
  autoAssignmentDisabled: boolean;

  @Prop({
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: Products.name }],
    required: false,
  })
  productIds: Types.ObjectId[];

  @Prop({ type: Number, default: 0, min: 0 })
  totalRegistrations: number;

  @Prop({ type: Number, default: 0, min: 0 })
  totalParticipants: number;

  @Prop({ type: Number, default: 0, min: 0 })
  totalAttendees: number;

  @Prop({ type: Number, default: 0, min: 0 })
  totalUnAttended: number;
}

export const WebinarSchema = SchemaFactory.createForClass(Webinar);

// Add pre-save middleware to transform `adminId` and `assignedEmployees` to ObjectId
WebinarSchema.pre('save', function (next) {
  if (typeof this.adminId === 'string') {
    this.adminId = new Types.ObjectId(`${this.adminId}`);
  }

  if (Array.isArray(this.productIds)) {
    this.productIds = this.productIds.map((productId) =>
      typeof productId === 'string'
        ? new Types.ObjectId(`${productId}`)
        : productId,
    );
  }

  if (Array.isArray(this.assignedEmployees)) {
    this.assignedEmployees = this.assignedEmployees.map((employee) =>
      typeof employee === 'string'
        ? new Types.ObjectId(`${employee}`)
        : employee,
    );
  }

  next();
});

WebinarSchema.index({ adminId: 1 });
WebinarSchema.index({ adminId: 1, totalRegistrations: 1 });
WebinarSchema.index({ adminId: 1, totalParticipants: 1 });
WebinarSchema.index({ adminId: 1, totalAttendees: 1 });
WebinarSchema.index({ adminId: 1, totalUnAttended: 1 });
