import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ProgramService } from './program.service';
import { CreateProgramDto } from './dto/create-program.dto';
import { UpdateProgramDto } from './dto/update-program.dto';
import { CreateProgramAssignmentDto } from './dto/create-program-assignment.dto';
import { Id } from '../decorators/custom.decorator';

@Controller('whatsapp-program')
export class ProgramController {
  constructor(private readonly programService: ProgramService) {}

  @Post()
  @UsePipes(new ValidationPipe({ transform: true }))
  create(@Body() dto: CreateProgramDto, @Id() adminId: string) {
    return this.programService.create(dto, adminId);
  }

  @Patch(':id')
  @UsePipes(new ValidationPipe({ transform: true }))
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProgramDto,
    @Id() adminId: string,
  ) {
    return this.programService.update(id, dto, adminId);
  }

  @Get()
  findAll(
    @Id() adminId: string,
    @Query('projectId') projectId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.programService.findAll(adminId, projectId, pageNum, limitNum);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Id() adminId: string) {
    return this.programService.findOne(id, adminId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Id() adminId: string) {
    return this.programService.remove(id, adminId);
  }

  @Post('assignments')
  @UsePipes(new ValidationPipe({ transform: true }))
  createAssignment(
    @Body() dto: CreateProgramAssignmentDto,
    @Id() adminId: string,
  ) {
    return this.programService.createAssignment(dto, adminId);
  }

  @Get('assignments/list')
  listAssignments(
    @Id() adminId: string,
    @Query('programId') programId?: string,
    @Query('projectId') projectId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.programService.listAssignments(
      adminId,
      programId,
      projectId,
      status as any,
      pageNum,
      limitNum,
    );
  }

  @Get('assignments/:assignmentId')
  getAssignment(
    @Param('assignmentId') assignmentId: string,
    @Id() adminId: string,
  ) {
    return this.programService.findAssignment(assignmentId, adminId);
  }

  @Get('assignments/:assignmentId/slots')
  getAssignmentSlots(
    @Param('assignmentId') assignmentId: string,
    @Id() adminId: string,
  ) {
    return this.programService.getAssignmentSlots(assignmentId, adminId);
  }

  @Post('assignments/:assignmentId/pause')
  pauseAssignment(
    @Param('assignmentId') assignmentId: string,
    @Id() adminId: string,
  ) {
    return this.programService.pauseAssignment(assignmentId, adminId);
  }

  @Post('assignments/:assignmentId/resume')
  resumeAssignment(
    @Param('assignmentId') assignmentId: string,
    @Id() adminId: string,
  ) {
    return this.programService.resumeAssignment(assignmentId, adminId);
  }

  @Post('assignments/:assignmentId/cancel')
  cancelAssignment(
    @Param('assignmentId') assignmentId: string,
    @Id() adminId: string,
  ) {
    return this.programService.cancelAssignment(assignmentId, adminId);
  }
}
