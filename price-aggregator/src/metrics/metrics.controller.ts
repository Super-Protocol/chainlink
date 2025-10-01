// Import necessary modules
import { Controller, Get, Header } from '@nestjs/common';
import { register } from 'prom-client';

@Controller('metrics')
export class MetricsController {
  @Get()
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async getMetrics(): Promise<string> {
    return register.metrics();
  }
}
