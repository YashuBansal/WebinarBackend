import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AutomationFlowDocument = HydratedDocument<AutomationFlow>;

@Schema({ timestamps: true })
export class AutomationFlow {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  adminId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  projectId: Types.ObjectId;

  @Prop({ type: String, required: true })
  name: string;

  @Prop({
    type: String,
    enum: ['crm', 'whatsapp'],
    default: 'crm',
    required: true,
  })
  flowType: 'crm' | 'whatsapp';

  @Prop({
    type: String,
    enum: ['active', 'inactive'],
    default: 'inactive',
    index: true,
  })
  status: 'active' | 'inactive';

  @Prop({ type: Types.ObjectId, ref: 'Webinar', index: true })
  webinarId?: Types.ObjectId; // for webinar-registration trigger

  @Prop({ type: Object, required: true })
  graph: any; // React Flow JSON { nodes, edges }
}

export const AutomationFlowSchema =
  SchemaFactory.createForClass(AutomationFlow);

AutomationFlowSchema.index({ projectId: 1, flowType: 1 });
