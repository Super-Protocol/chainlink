import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { HttpClientModule } from '../common';
import { AppConfigModule } from '../config';
import { SourcesExceptionFilter } from './filters';
import { SourcesManagerService } from './sources-manager.service';
import { SOURCES_PROVIDERS } from './sources.constants';
import { SourcesController } from './sources.controller';
import { MetricsModule } from '../metrics/metrics.module';

@Module({
  imports: [AppConfigModule, HttpModule, HttpClientModule, MetricsModule],
  controllers: [SourcesController],
  providers: [
    SourcesManagerService,
    ...SOURCES_PROVIDERS,
    {
      provide: APP_FILTER,
      useClass: SourcesExceptionFilter,
    },
  ],
  exports: [SourcesManagerService],
})
export class SourcesModule {}
