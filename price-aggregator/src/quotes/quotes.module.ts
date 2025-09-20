import { Module } from '@nestjs/common';

import { BatchQuotesService } from './batch-quotes.service';
import { CacheService } from './cache';
import { PairService } from './pair.service';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import { SourcesModule } from '../sources/sources.module';

@Module({
  imports: [SourcesModule],
  controllers: [QuotesController],
  providers: [QuotesService, BatchQuotesService, PairService, CacheService],
  exports: [QuotesService, PairService],
})
export class QuotesModule {}
