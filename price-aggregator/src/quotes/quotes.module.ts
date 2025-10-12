import { Module } from '@nestjs/common';

import { BatchQuotesService } from './batch-quotes.service';
import { CacheService, CacheStalenessService } from './cache';
import { FailedPairsRetryService } from './failed-pairs-retry.service';
import { PairCleanupService } from './pair-cleanup.service';
import { PairService } from './pair.service';
import { QuoteBatchProcessorService } from './quote-batch-processor.service';
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
    CacheStalenessService,
    RefetchService,
    FailedPairsRetryService,
    StreamingQuotesService,
    QuoteBatchProcessorService,
  ],
  exports: [QuotesService, PairService],
})
export class QuotesModule {}
