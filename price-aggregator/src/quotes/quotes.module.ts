import { Module } from '@nestjs/common';

import { CacheService } from './cache';
import { PairService } from './pair.service';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import { SourcesModule } from '../sources/sources.module';

@Module({
  imports: [SourcesModule],
  controllers: [QuotesController],
  providers: [QuotesService, PairService, CacheService],
  exports: [QuotesService, PairService],
})
export class QuotesModule {}
