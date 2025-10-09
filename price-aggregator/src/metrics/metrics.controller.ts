import { Controller, Get, Header } from '@nestjs/common';
import { register } from 'prom-client';

import { MetricsService } from './metrics.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async getMetrics(): Promise<string> {
    this.metricsService.updateAllSourceAgeMetrics();
    return register.metrics();
  }
}
