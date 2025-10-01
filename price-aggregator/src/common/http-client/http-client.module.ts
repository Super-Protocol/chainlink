import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';

import { ProxyModule } from '../proxy';
import { HttpClientBuilder } from './http-client.builder';
import { RpsLimiterService } from './rps-limiter.service';

@Module({
  imports: [HttpModule, ProxyModule],
  providers: [RpsLimiterService, HttpClientBuilder],
  exports: [HttpClientBuilder],
})
export class HttpClientModule {}
