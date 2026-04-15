import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Project } from 'src/schemas/project.schema';
import { User } from 'src/schemas/User.schema';

export type AlarmWhatsappConfigDocument = AlarmWhatsappConfig & Document;

export class VariableMapping {
  @Prop({ type: String, required: true })
  variable: string;

  @Prop({ type: Boolean, default: true })
  isDynamic: boolean;

  @Prop({ type: String })
  contactField?: string;

  @Prop({ type: String })
  staticValue?: string;

  @Prop({ type: String })
  fallbackValue?: string;
}

@Schema({ timestamps: true })
export class AlarmWhatsappConfig extends Document {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true, index: true })
  adminId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: Project.name,
    required: true,
    index: true,
  })
  projectId: Types.ObjectId;

  @Prop({ type: Boolean, default: true })
  enabled: boolean;

  @Prop({ type: String, required: true })
  mainAlarmTemplateName: string;

  @Prop({ type: String, default: 'en_US' })
  mainAlarmLanguage: string;

  @Prop({ type: String, required: false })
  mainAlarmHeaderMediaAssetId?: string;

  @Prop({ type: [VariableMapping], default: [] })
  mainAlarmVariableMappings: VariableMapping[];

  @Prop({ type: String, required: true })
  reminderTemplateName: string;

  @Prop({ type: String, default: 'en_US' })
  reminderLanguage: string;

  @Prop({ type: String, required: false })
  reminderHeaderMediaAssetId?: string;

  @Prop({ type: [VariableMapping], default: [] })
  reminderVariableMappings: VariableMapping[];

  @Prop({ type: Number, default: 0 })
  mainAlarmSent: number;

  @Prop({ type: Number, default: 0 })
  reminderSent: number;

  @Prop({ type: Number, default: 0 })
  mainAlarmFailed: number;

  @Prop({ type: Number, default: 0 })
  reminderFailed: number;

  @Prop({ type: String, required: false })
  lastError?: string;
}

export const AlarmWhatsappConfigSchema =
  SchemaFactory.createForClass(AlarmWhatsappConfig);
AlarmWhatsappConfigSchema.index({ adminId: 1, projectId: 1 }, { unique: true });
