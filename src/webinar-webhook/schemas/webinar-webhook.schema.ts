import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { User } from 'src/schemas/User.schema';
import { Webinar } from 'src/schemas/Webinar.schema';

export type WebinarWebhookDocument = WebinarWebhook & Document;

@Schema({ timestamps: true })
export class WebinarWebhook {
  @Prop({ required: true, type: Types.ObjectId, ref: Webinar.name })
  webinarId: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: User.name })
  adminId: Types.ObjectId;

  @Prop({ required: false, type: String })
  webhookUrl?: string;

  @Prop({required: true, type: String})
  webhookName: string;
  
  @Prop({default: false, type: Boolean})
  isResponseCaptured: boolean;

  @Prop({default: true, type: Boolean})
  isActive: boolean;

  @Prop({required: false, type: Date})
  lastCapturedAt?: Date;

  @Prop({required: false, type: Object})
  lastCapturedData?: any;

  @Prop({required: false, type: String})
  webhookToken?: string;

  @Prop({required: false, type: Object})
  fieldMapping?: {
    email: string; // Required field
    firstName?: string;
    lastName?: string;
    phone?: string;
    location?: string;
    gender?: string;
    tags?: string;
    source?: string;
  };

}

export const WebinarWebhookSchema = SchemaFactory.createForClass(WebinarWebhook);
