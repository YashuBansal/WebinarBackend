import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Project } from 'src/schemas/project.schema';
import { User } from 'src/schemas/User.schema';
import { CampaignContactType } from 'src/schemas/whatsapp-embed/campaign.schema';
import { MediaAsset } from '../../whatsapp/schemas/media-asset.schema';

export type ConfiguredTemplateDocument = ConfiguredTemplate & Document;

@Schema({ _id: false })
export class variableMappingData {
    @Prop({
        type: String,
        required: [true, 'Variable name is required'],
        trim: true,
        maxlength: 100,
    })
    variable: string;

    @Prop({
        type: String,
        required: false,
        trim: true,
    })
    dynamicField?: string;


    @Prop({
        type: Boolean,
        required: true,
        default: false,
    })
    isDynamic: boolean;

    @Prop({
        type: String,
        required: false,
        trim: true,
    })
    fallbackValue?: string;


    @Prop({
        type: String,
        required: false,
        trim: true,
    })
    staticValue: string;
}

@Schema({ timestamps: true })
export class ConfiguredTemplate extends Document {

    @Prop({
        type: Types.ObjectId,
        ref: User.name,
        required: [true, 'Admin ID is required'],
    })
    adminId: Types.ObjectId;

    @Prop({
        type: Types.ObjectId,
        ref: Project.name,
        required: [true, 'Project ID is required'],
    })
    project: Types.ObjectId;

    @Prop({
        type: String,
        required: [true, 'Template name is required'],
        trim: true,
        maxlength: 100,
    })
    templateName: string;


    @Prop({
        type: String,
        required: [true, 'Configured Template name is required'],
        trim: true,
        maxlength: 100,
    })
    configuredTemplateName: string;

    @Prop({
        type: [variableMappingData],
        default: []
    })
    variableMappings: variableMappingData[];


    @Prop({
        ref: MediaAsset.name,
        type: Types.ObjectId,
        required: false,
    })
    headerMediaAssetId: Types.ObjectId;


    @Prop({
        type: Boolean,
        default: true,
    })
    isActive: boolean;

    @Prop({
        type: Boolean,
        default: false,
    })
    isDeleted: boolean;
}

const ConfiguredTemplateSchema = SchemaFactory.createForClass(ConfiguredTemplate);

// Pre-save middleware to convert string IDs to ObjectIds
ConfiguredTemplateSchema.pre('save', function (next) {
    if (typeof this.project === 'string') {
        this.project = new Types.ObjectId(`${this.project}`);
    }
    if (typeof this.adminId === 'string') {
        this.adminId = new Types.ObjectId(`${this.adminId}`);
    }
    if (typeof this.headerMediaAssetId === 'string') {
        this.headerMediaAssetId = new Types.ObjectId(`${this.headerMediaAssetId}`);
    }

    next();
});

export { ConfiguredTemplateSchema };
