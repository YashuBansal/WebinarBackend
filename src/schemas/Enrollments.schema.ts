import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from './User.schema';
import { Products } from './Products.schema';
import { Webinar } from './Webinar.schema';

export enum AssignType {
  AUTO = 'auto',
  MANUAL = 'manual',
}

@Schema({ timestamps: true })
export class Enrollment extends Document {
  @Prop({
    type: String,
    required: [true, 'Attendee E-Mail is required.'],
  })
  attendee: string;

  @Prop({
    type: Types.ObjectId,
    ref: Webinar.name,
    required: [true, 'Webinar Id is required.'],
  })
  webinar: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: Products.name,
    require: [true, 'Product ID is required.'],
  })
  product: Types.ObjectId;

  @Prop({
    type: Number,
    min: 0,
    default: 0,
    required: [true, 'Product price is required'],
  })
  price: number;

  @Prop({
    type: Types.ObjectId,
    ref: User.name,
    required: [true, 'Admin Id is required'],
  })
  adminId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: User.name,
  })
  assignedBy: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(AssignType),
    default: AssignType.AUTO,
  })
  assignType: AssignType;
}

const EnrollmentSchema = SchemaFactory.createForClass(Enrollment);

EnrollmentSchema.pre('save', function (next) {
  if (typeof this.webinar === 'string') {
    this.webinar = new Types.ObjectId(`${this.webinar}`);
  }
  if (typeof this.product === 'string') {
    this.product = new Types.ObjectId(`${this.product}`);
  }
  if (typeof this.adminId === 'string') {
    this.adminId = new Types.ObjectId(`${this.adminId}`);
  }
  next();
});

EnrollmentSchema.index({ adminId: 1, attendee: 1 });

export { EnrollmentSchema };
