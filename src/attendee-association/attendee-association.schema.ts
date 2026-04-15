import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { CustomLeadType } from '../schemas/custom-lead-type.schema';
import { User } from '../schemas/User.schema';

@Schema({ timestamps: true })
export class AttendeeAssociation extends Document {
  @Prop({
    type: String,
    maxlength: 100,
    required: [true, 'Email is required'],
    trim: true,
  })
  email: string; // E-Mail

  @Prop({
    type: Types.ObjectId,
    ref: CustomLeadType.name,
    required: false,
  })
  leadType: Types.ObjectId; //Lead Type

  @Prop({
    type: [String],
    default: [],
    set: (fullNames: string[]) => {
      if (!Array.isArray(fullNames)) {
        return [];
      }
      // Filter out "undefined" strings, empty strings, and null/undefined values
      return fullNames
        .filter(
          (name) => name != null && name !== 'undefined' && name.trim() !== '',
        )
        .map((name) => name.trim());
    },
  })
  fullNames: string[]; //Full Names

  @Prop({
    type: [String],
    default: [],
  })
  phones: string[]; //Phones

  @Prop({
    type: [String],
    default: [],
    set: (tags: string[]) =>
      Array.from(
        new Set(tags.map((tag) => tag.toLowerCase().trim()).filter(Boolean)),
      ),
  })
  tags: string[]; //Tags

  @Prop({
    type: Types.ObjectId,
    ref: User.name,
    required: [true, 'adminId is required'],
  })
  adminId: Types.ObjectId;
}

export const AttendeeAssociationSchema =
  SchemaFactory.createForClass(AttendeeAssociation);

AttendeeAssociationSchema.pre('save', function (next) {
  if (typeof this.leadType === 'string') {
    this.leadType = new Types.ObjectId(`${this.leadType}`);
  }

  next();
});

AttendeeAssociationSchema.index({ adminId: 1, email: 1, leadType: 1 });
