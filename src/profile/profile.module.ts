import { MiddlewareConsumer, Module } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { ProfileController } from './profile.controller';
import { AuthAdminTokenMiddleware } from 'src/middlewares/authAdmin.Middleware';
import { ProjectsModule } from 'src/projects/projects.module';
import { HttpModule } from '@nestjs/axios';
import { UsersModule } from 'src/users/users.module';

@Module({
  imports: [HttpModule, ProjectsModule, UsersModule],
  providers: [ProfileService],
  controllers: [ProfileController],
  exports: [ProfileService],
})
export class ProfileModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthAdminTokenMiddleware).forRoutes(ProfileController);
  }
}
