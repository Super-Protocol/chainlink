import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { HttpClientModule, ProxyModule } from '../common';
import { WebSocketClientBuilder } from '../common';
import { AppConfigModule } from '../config';
import { SourcesExceptionFilter } from './filters';
import { SourcesManagerService } from './sources-manager.service';
import { SourcesController } from './sources.controller';
import { SOURCES_PROVIDERS } from './sources.providers';
import { MetricsModule } from '../metrics/metrics.module';

@Module({
  imports: [
    AppConfigModule,
    HttpModule,
    HttpClientModule,
    ProxyModule,
    MetricsModule,
  ],
  controllers: [SourcesController],
  providers: [
    SourcesManagerService,
    ...SOURCES_PROVIDERS,
    WebSocketClientBuilder,
    {
      provide: APP_FILTER,
      useClass: SourcesExceptionFilter,
    },
  ],
  exports: [SourcesManagerService],
})
export class SourcesModule {}
