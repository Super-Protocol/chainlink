import { Module } from '@nestjs/common';

import { PairService } from './pair.service';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import { SourcesModule } from '../sources/sources.module';

@Module({
  imports: [SourcesModule],
  controllers: [QuotesController],
  providers: [QuotesService, PairService],
  exports: [QuotesService, PairService],
})
export class QuotesModule {}
