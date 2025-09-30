import { Module } from '@nestjs/common';

import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { PushMetricsService } from './push-metrics.service';

@Module({
  controllers: [MetricsController],
  providers: [MetricsService, PushMetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
