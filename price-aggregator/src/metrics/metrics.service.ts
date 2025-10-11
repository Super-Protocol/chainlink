import { Injectable, Logger } from '@nestjs/common';
import { Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

import { formatPairLabel, formatPairKey } from '../common';
import type { SourceName } from '../sources';
import type { Pair } from '../sources/source-adapter.interface';

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  private static defaultMetricsRegistered = false;

  constructor() {
    if (!MetricsService.defaultMetricsRegistered) {
      collectDefaultMetrics({
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
    buckets: [
      0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5,
      6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 15, 20, 30, 45, 60,
    ],
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
    buckets: [0.1, 0.5, 1, 2, 5, 10, 15, 20, 30, 45, 60],
  });

  public readonly sourceApiLatency = new Histogram({
    name: 'source_api_duration_seconds',
    help: 'Duration of API requests by source',
    labelNames: ['source', 'method', 'status'],
    buckets: [
      0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5,
      6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 15, 20, 30, 45, 60,
    ],
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

  public readonly registeredPairs = new Gauge({
    name: 'registered_pairs',
    help: 'Registry of all registered currency pairs (value is always 1)',
    labelNames: ['pair', 'source'],
  });

  public readonly priceNotFoundCount = new Counter({
    name: 'price_not_found_total',
    help: 'Total number of price not found errors',
    labelNames: ['source', 'pair'],
  });

  public readonly quoteRequestErrors = new Counter({
    name: 'quote_request_errors_total',
    help: 'Total number of failed quote requests',
    labelNames: ['source', 'pair'],
  });

  public readonly cacheMissByPair = new Counter({
    name: 'cache_miss_by_pair_total',
    help: 'Total number of cache misses by pair',
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

  public readonly restRequests = new Counter({
    name: 'source_rest_requests_total',
    help: 'Total number of REST requests sent to external sources',
    labelNames: ['source', 'status'],
  });

  public readonly sourceLastUpdateAge = new Gauge({
    name: 'source_last_update_age_seconds',
    help: 'Seconds since last successful update from source',
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
    help: 'Time between price updates from source',
    labelNames: ['source'],
    buckets: [1, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300],
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

  public readonly quoteDataAge = new Gauge({
    name: 'quote_data_age_seconds',
    help: 'Age of quote data returned by API (current time - receivedAt)',
    labelNames: ['source', 'pair'],
  });

  private lastUpdateTimes = new Map<string, number>();

  updateSourceLastUpdate(source: string, pair: string[]): void {
    const now = Date.now();
    const pairKey = formatPairKey(pair as Pair);
    const lastUpdateTime = this.lastUpdateTimes.get(`${source}-${pairKey}`);

    if (lastUpdateTime !== undefined && lastUpdateTime > 0) {
      const timeDiff = (now - lastUpdateTime) / 1000;
      this.priceUpdateFrequency.observe({ source }, timeDiff);
    }

    this.lastUpdateTimes.set(`${source}-${pairKey}`, now);
  }

  removePairMetrics(pair: Pair, source: SourceName): void {
    const pairKey = formatPairKey(pair);
    const pairLabel = formatPairLabel(pair);

    this.sourceLastUpdateAge.remove({ source, pair: pairLabel });
    this.priceNotFoundCount.remove({ source, pair: pairLabel });
    this.quoteRequestErrors.remove({ source, pair: pairLabel });
    this.cacheMissByPair.remove({ source, pair: pairLabel });
    this.priceUpdateFrequency.remove({ source });
    this.registeredPairs.remove({ source, pair: pairLabel });
    this.quoteDataAge.remove({ source, pair: pairKey });

    this.lastUpdateTimes.delete(`${source}-${pairKey}`);

    this.logger.debug({ source, pair: pairLabel }, 'Removed metrics for pair');
  }

  updateQuoteDataAge(source: SourceName, pair: Pair, receivedAt: Date): void {
    const now = Date.now();
    const receivedAtMs = receivedAt.getTime();
    const ageSeconds = (now - receivedAtMs) / 1000;
    const pairKey = pair.join('-');

    if (ageSeconds < 0) {
      this.quoteDataAge.set({ source, pair: pairKey }, 0);
    } else {
      this.quoteDataAge.set({ source, pair: pairKey }, ageSeconds);
    }
  }

  updateAllSourceAgeMetrics(): void {
    const now = Date.now();

    for (const [key, lastUpdateTime] of this.lastUpdateTimes.entries()) {
      const ageSeconds = (now - lastUpdateTime) / 1000;
      const [source, ...pairParts] = key.split('-');
      const pair = pairParts as Pair;
      const pairLabel = formatPairLabel(pair);

      this.sourceLastUpdateAge.set({ source, pair: pairLabel }, ageSeconds);
    }
  }

  public readonly globalMarketDataLastUpdate = new Gauge({
    name: 'global_market_data_last_update_timestamp',
    help: 'Timestamp of last global market data update',
  });

  public readonly globalMarketDataAge = new Gauge({
    name: 'global_market_data_age_seconds',
    help: 'Age of cached global market data in seconds',
  });

  public readonly globalMarketDataErrors = new Counter({
    name: 'global_market_data_refresh_errors_total',
    help: 'Total number of errors while refreshing global market data',
  });

  updateGlobalMarketDataMetrics(data: { updatedAt: Date }): void {
    const timestamp = data.updatedAt.getTime() / 1000;
    const ageSeconds = (Date.now() - data.updatedAt.getTime()) / 1000;

    this.globalMarketDataLastUpdate.set(timestamp);
    this.globalMarketDataAge.set(ageSeconds);
  }
}
