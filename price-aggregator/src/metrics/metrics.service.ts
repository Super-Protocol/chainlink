import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

@Injectable()
export class MetricsService {
  constructor() {
    collectDefaultMetrics({
      prefix: 'nodejs_',
      gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5],
      eventLoopMonitoringPrecision: 10,
    });
  }

  public readonly requestLatency = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['route', 'method', 'status'],
    buckets: [0.1, 0.5, 1, 2, 5],
  });

  public readonly requestCount = new Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['route', 'method', 'status'],
  });

  public readonly errorCount = new Counter({
    name: 'app_errors_total',
    help: 'Total number of application errors',
    labelNames: ['type', 'source'],
  });

  public readonly cacheHits = new Counter({
    name: 'cache_hits_total',
    help: 'Total number of cache hits',
    labelNames: ['source'],
  });

  public readonly cacheMisses = new Counter({
    name: 'cache_misses_total',
    help: 'Total number of cache misses',
    labelNames: ['source'],
  });

  public readonly fetchLatency = new Histogram({
    name: 'source_fetch_duration_seconds',
    help: 'Duration of source fetches in seconds',
    labelNames: ['source'],
    buckets: [0.1, 0.5, 1, 2, 5],
  });

  public readonly cacheSize = new Gauge({
    name: 'cache_size',
    help: 'Current number of items in cache',
    labelNames: ['source'],
  });

  public readonly trackedPairs = new Gauge({
    name: 'tracked_pairs_total',
    help: 'Total number of tracked currency pairs',
    labelNames: ['source'],
  });

  public readonly totalPairs = new Gauge({
    name: 'pairs_total',
    help: 'Total number of unique currency pairs across all sources',
  });

  public readonly priceNotFoundCount = new Counter({
    name: 'price_not_found_total',
    help: 'Total number of price not found errors',
    labelNames: ['source', 'pair'],
  });

  public readonly rateLimitHits = new Counter({
    name: 'rate_limit_hits_total',
    help: 'Total number of rate limit (429) responses',
    labelNames: ['source'],
  });

  public readonly batchSize = new Histogram({
    name: 'batch_size',
    help: 'Size of batch requests',
    labelNames: ['source'],
    buckets: [1, 5, 10, 20, 50, 100],
  });

  public readonly quoteThroughput = new Counter({
    name: 'quotes_processed_total',
    help: 'Total number of quotes processed',
    labelNames: ['source', 'status'],
  });
}
