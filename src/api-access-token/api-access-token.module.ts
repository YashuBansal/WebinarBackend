import { Module } from '@nestjs/common';
import { ApiAccessTokenService } from './api-access-token.service';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ApiAccessToken,
  ApiAccessTokenSchema,
} from 'src/schemas/api-token.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: ApiAccessToken.name,
        schema: ApiAccessTokenSchema,
      },
    ]),
  ],
  providers: [ApiAccessTokenService],
  exports: [ApiAccessTokenService],
})
export class ApiAccessTokenModule {}
