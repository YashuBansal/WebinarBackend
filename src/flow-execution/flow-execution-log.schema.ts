import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type FlowExecutionLogDocument = FlowExecutionLog & Document;

@Schema({ timestamps: { createdAt: 'executedAt', updatedAt: false } })
export class FlowExecutionLog extends Document {
  @Prop({ type: String, required: true, index: true })
  flowId: string;

  @Prop({ type: String, required: true, index: true })
  projectId: string;

  @Prop({ type: String, enum: ['success', 'failed'], required: true })
  status: string;

  @Prop({ type: Object, default: {} })
  logs: Record<string, any>;

  @Prop({ type: String })
  error?: string;
  
  @Prop({ type: String, index: true })
  jobId?: string;
}

export const FlowExecutionLogSchema = SchemaFactory.createForClass(FlowExecutionLog);

FlowExecutionLogSchema.index({ flowId: 1, executedAt: -1 });
FlowExecutionLogSchema.index({ projectId: 1, executedAt: -1 });
