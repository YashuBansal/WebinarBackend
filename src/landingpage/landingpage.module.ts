import { forwardRef, MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { LandingpageController } from './landingpage.controller';
import { LandingpageService } from './landingpage.service';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { MongooseModule } from '@nestjs/mongoose';
import { LandingPage, LandingPageSchema } from 'src/schemas/LandingPage.schema';
import { AuthSuperAdminMiddleware } from 'src/middlewares/authSuperAdmin.Middleware';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';
import { UsersModule } from 'src/users/users.module';

@Module({
  imports: [
    MulterModule.register({
      storage: diskStorage({
        destination: './uploads',
        filename: (req, file, cb) => {
          const filename = `${Date.now()}-${file.originalname}`;
          cb(null, filename);
        },
      }),
    }),
    forwardRef(() =>UsersModule),
    MongooseModule.forFeature([
      {
        name: LandingPage.name,
        schema: LandingPageSchema,
      },
    ]),
  ],
  controllers: [LandingpageController],
  providers: [LandingpageService, CloudinaryService],
})
export class LandingpageModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthSuperAdminMiddleware)
      .forRoutes({ path: '/landingpage', method: RequestMethod.POST });
  }
}
