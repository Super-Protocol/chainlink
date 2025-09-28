import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

@Injectable()
export class MetricsService {
  private static defaultMetricsRegistered = false;

  constructor() {
    if (!MetricsService.defaultMetricsRegistered) {
      collectDefaultMetrics({
        prefix: 'nodejs_',
        gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5],
        eventLoopMonitoringPrecision: 10,
      });
      MetricsService.defaultMetricsRegistered = true;
    }
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

  public readonly sourceApiErrors = new Counter({
    name: 'source_api_errors_total',
    help: 'Total number of API errors from external sources',
    labelNames: ['source', 'status_code', 'error_type'],
  });

  public readonly sourceLastUpdate = new Gauge({
    name: 'source_last_successful_update_timestamp',
    help: 'Timestamp of last successful update from source',
    labelNames: ['source', 'pair'],
  });

  public readonly websocketConnections = new Gauge({
    name: 'websocket_connections_total',
    help: 'Number of active websocket connections',
    labelNames: ['source'],
  });

  public readonly websocketErrors = new Counter({
    name: 'websocket_errors_total',
    help: 'Total number of websocket errors',
    labelNames: ['source', 'error_type'],
  });

  public readonly websocketMessages = new Counter({
    name: 'websocket_messages_received_total',
    help: 'Total number of websocket messages received',
    labelNames: ['source'],
  });

  public readonly priceUpdateFrequency = new Histogram({
    name: 'price_update_frequency_seconds',
    help: 'Time between price updates for each pair',
    labelNames: ['pair', 'source'],
    buckets: [1, 5, 10, 30, 60, 300, 600],
  });

  public readonly websocketReconnects = new Counter({
    name: 'websocket_reconnects_total',
    help: 'Total number of websocket reconnections',
    labelNames: ['source', 'reason'],
  });

  public readonly messageDropRate = new Gauge({
    name: 'message_drop_rate',
    help: 'Rate of dropped messages from websocket streams',
    labelNames: ['source'],
  });

  private lastUpdateTimes = new Map<string, number>();

  updateSourceLastUpdate(source: string, pair: string[]): void {
    const now = Date.now();
    const pairKey = pair.join('-');
    const lastUpdateTime = this.lastUpdateTimes.get(`${source}-${pairKey}`);

    this.sourceLastUpdate.set({ source, pair: pairKey }, now / 1000);

    if (lastUpdateTime) {
      const timeDiff = (now - lastUpdateTime) / 1000;
      this.priceUpdateFrequency.observe({ pair: pairKey, source }, timeDiff);
    }

    this.lastUpdateTimes.set(`${source}-${pairKey}`, now);
  }
}
