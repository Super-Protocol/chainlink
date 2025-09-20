import { Module } from '@nestjs/common';

import { BatchQuotesService } from './batch-quotes.service';
import { CacheService } from './cache';
import { PairCleanupService } from './pair-cleanup.service';
import { PairService } from './pair.service';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import { RefetchService } from './refetch.service';
import { StreamingQuotesService } from './streaming-quotes.service';
import { MetricsModule } from '../metrics/metrics.module';
import { SourcesModule } from '../sources/sources.module';

@Module({
  imports: [SourcesModule, MetricsModule],
  controllers: [QuotesController],
  providers: [
    QuotesService,
    BatchQuotesService,
    PairService,
    PairCleanupService,
    CacheService,
    RefetchService,
    StreamingQuotesService,
  ],
  exports: [QuotesService, PairService],
})
export class QuotesModule {}
