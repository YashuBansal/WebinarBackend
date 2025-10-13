import { Prop, Schema } from "@nestjs/mongoose";
import { Types } from "mongoose";


@Schema({ timestamps: true })
export class DelayedMeetingEvents {
    _id: Types.ObjectId;

    @Prop({
        type: String,
        required: true,
    })
    meetingId: string; 
    
    
}