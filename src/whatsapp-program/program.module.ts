import { forwardRef, MiddlewareConsumer, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { Program, ProgramSchema } from './schemas/program.schema';
import {
  ProgramAssignment,
  ProgramAssignmentSchema,
} from './schemas/program-assignment.schema';
import { ProgramSlot, ProgramSlotSchema } from './schemas/program-slot.schema';
import { ProgramController } from './program.controller';
import { ProgramService } from './program.service';
import { ProjectsModule } from 'src/projects/projects.module';
import { ContactsModule } from 'src/contacts/contacts.module';
import { AuthAdminTokenMiddleware } from 'src/middlewares/authAdmin.Middleware';
import { WhatsappModule } from 'src/whatsapp/whatsapp.module';
import { UsersModule } from 'src/users/users.module';

@Module({
  imports: [
    ScheduleModule,
    MongooseModule.forFeature([
      { name: Program.name, schema: ProgramSchema },
      { name: ProgramAssignment.name, schema: ProgramAssignmentSchema },
      { name: ProgramSlot.name, schema: ProgramSlotSchema },
    ]),
    ProjectsModule,
    ContactsModule,
    forwardRef(() => UsersModule),
    forwardRef(() => WhatsappModule),
  ],
  controllers: [ProgramController],
  providers: [ProgramService],
  exports: [ProgramService],
})
export class ProgramModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthAdminTokenMiddleware)
      .forRoutes(ProgramController);
  }
}
