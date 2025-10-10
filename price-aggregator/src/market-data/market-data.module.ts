import { Module } from '@nestjs/common';

import { GlobalMarketDataController } from './global-market-data.controller';
import { GlobalMarketDataService } from './global-market-data.service';
import { HttpClientModule } from '../common';
import { AppConfigModule } from '../config';
import { MetricsModule } from '../metrics/metrics.module';

@Module({
  imports: [HttpClientModule, AppConfigModule, MetricsModule],
  controllers: [GlobalMarketDataController],
  providers: [GlobalMarketDataService],
  exports: [GlobalMarketDataService],
})
export class MarketDataModule {}
