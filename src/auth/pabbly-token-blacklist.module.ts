import { Global, Module } from '@nestjs/common';
import { ApiAccessTokenModule } from 'src/api-access-token/api-access-token.module';
import { RedisModule } from 'src/redis/redis.module';
import { PabblyTokenBlacklistService } from './pabbly-token-blacklist.service';

@Global()
@Module({
  imports: [RedisModule, ApiAccessTokenModule],
  providers: [PabblyTokenBlacklistService],
  exports: [PabblyTokenBlacklistService],
})
export class PabblyTokenBlacklistModule {}
