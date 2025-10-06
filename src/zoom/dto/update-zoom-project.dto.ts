import { PartialType } from '@nestjs/mapped-types';
import { CreateZoomProjectDto } from './create-zoom-project.dto';

export class UpdateZoomProjectDto extends PartialType(CreateZoomProjectDto) {}
