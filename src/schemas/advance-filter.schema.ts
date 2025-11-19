// const wlhConditionSchema = z.object({
//     mode: z.enum(['include', 'exclude']),
//     field: z.enum(['email', 'tags']),
//     operator: z.enum(['equals', 'contains']),
//     value: z.array(z.string()),
//     logicOperator: z.enum(['AND', 'OR']).optional(),
//   });

export enum AdvanceFilterMode {
    INCLUDE = 'include',
    EXCLUDE = 'exclude',
}

export enum AdvanceFilterOperator {
    EQUALS = 'equals',
    CONTAINS = 'contains',
    STARTS_WITH = 'starts_with',
    ENDS_WITH = 'ends_with',
}

export enum AdvanceFilterLogicOperator {
    AND = 'AND',
    OR = 'OR',
}



// addon.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

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
        type: Boolean,
        required: true,
        default: false,
    })
    isMongoId: boolean;

}

export const AdvanceFilterSchema = SchemaFactory.createForClass(AdvanceFilter);
