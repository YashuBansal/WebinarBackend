import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AutomationExecutionDocument = HydratedDocument<AutomationExecution>;

@Schema({ timestamps: true })
export class AutomationExecution {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  adminId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  projectId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    required: true,
    ref: 'AutomationFlow',
    index: true,
  })
  flowId: Types.ObjectId;

  @Prop({
    type: String,
    enum: ['PENDING', 'RUNNING', 'DELAYED', 'FAILED', 'COMPLETED'],
    default: 'PENDING',
    index: true,
  })
  status: 'PENDING' | 'RUNNING' | 'DELAYED' | 'FAILED' | 'COMPLETED';

  @Prop({ type: Object })
  triggerData?: any; // raw registrant payload

  @Prop({ type: String })
  currentNodeId?: string;

  @Prop({ type: Date })
  executeAt?: Date; // for delays

  @Prop({ type: Array, default: [] })
  logs: Array<{
    timestamp: string;
    level: 'info' | 'error';
    message: string;
    meta?: any;
  }>;
}

export const AutomationExecutionSchema =
  SchemaFactory.createForClass(AutomationExecution);
