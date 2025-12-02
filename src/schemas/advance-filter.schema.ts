import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export enum AdvanceFilterMode {
  INCLUDE = 'include',
  EXCLUDE = 'exclude',
}

export enum AdvanceFilterOperator {
  EQUALS = 'equals',
  CONTAINS = 'contains',
  STARTS_WITH = 'starts_with',
  ENDS_WITH = 'ends_with',
  GREATER_THAN_OR_EQUAL = 'greater_than_or_equal',
  LESS_THAN_OR_EQUAL = 'less_than_or_equal',
}

export enum AdvanceFilterLogicOperator {
  AND = 'AND',
  OR = 'OR',
}

export enum AdvanceFilterFieldType {
  STRING = 'string',
  NUMBER = 'number',
  BOOLEAN = 'boolean',
  DATE = 'date',
  MONGODB_ID = 'mongodb_id',
}

@Schema({ timestamps: true })
export class AdvanceFilter extends Document {
  @Prop({
    type: String,
    enum: Object.values(AdvanceFilterMode),
    required: true,
  })
  mode: AdvanceFilterMode;

  @Prop({
    type: String,
    enum: Object.values(AdvanceFilterOperator),
    required: true,
  })
  operator: AdvanceFilterOperator;

  @Prop({
    type: String,
    enum: Object.values(AdvanceFilterLogicOperator),
    required: true,
  })
  logicOperator: AdvanceFilterLogicOperator;

  @Prop({
    type: [String],
    required: true,
  })
  value: string[];

  @Prop({
    type: String,
    required: true,
  })
  field: string;

  @Prop({
    type: String,
    enum: Object.values(AdvanceFilterFieldType),
    required: true,
  })
  fieldType: AdvanceFilterFieldType;

  @Prop({
    type: Boolean,
    required: true,
    default: false,
  })
  isMultiple: boolean;
}

export const AdvanceFilterSchema = SchemaFactory.createForClass(AdvanceFilter);
