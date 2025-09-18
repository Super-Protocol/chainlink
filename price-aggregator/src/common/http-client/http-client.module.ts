import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';

import { HttpClientBuilder } from './http-client.builder';
import { RpsLimiterService } from './rps-limiter.service';

@Module({
  imports: [HttpModule],
  providers: [RpsLimiterService, HttpClientBuilder],
  exports: [HttpClientBuilder],
})
export class HttpClientModule {}
