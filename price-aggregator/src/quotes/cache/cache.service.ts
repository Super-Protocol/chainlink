import { EventEmitter } from 'events';

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createCache, Cache } from 'cache-manager';

import {
  CacheMetadata,
  StaleItem,
  StaleBatch,
  StalenessConfig,
} from './cache-staleness.interface';
import { CachedQuote, SerializedCachedQuote } from './cache.interface';
import { AppConfigService } from '../../config/config.service';
import { MetricsService } from '../../metrics/metrics.service';
import { SourceName } from '../../sources';
import { Pair } from '../../sources/source-adapter.interface';
import { SourcesManagerService } from '../../sources/sources-manager.service';

@Injectable()
export class CacheService extends EventEmitter implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private cache: Cache;
  private cacheMetadata = new Map<string, CacheMetadata>();
  private stalenessTimers = new Map<string, NodeJS.Timeout>();
  private pendingStaleBatch: StaleItem[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private stalenessConfig: StalenessConfig;

  constructor(
    private readonly sourcesManager: SourcesManagerService,
    private readonly configService: AppConfigService,
    private readonly metricsService: MetricsService,
  ) {
    super();
    this.cache = createCache({
      ttl: 60000,
    });
    this.stalenessConfig = this.configService.get('refetch');
    this.updateCacheSizeMetrics();
  }

  onModuleDestroy(): void {
    this.stalenessTimers.forEach((timer) => clearTimeout(timer));
    this.stalenessTimers.clear();
    if (this.batchTimer) clearTimeout(this.batchTimer);
  }

  async get(source: SourceName, pair: Pair): Promise<CachedQuote | null> {
    const key = this.generateCacheKey(source, pair);

    try {
      const cached = await this.cache.get<SerializedCachedQuote>(key);

      if (cached) {
        this.logger.debug(`Cache hit for ${key}`);
        return {
          ...cached,
          receivedAt: new Date(cached.receivedAt),
          cachedAt: new Date(cached.cachedAt),
        };
      }

      this.logger.debug(`Cache miss for ${key}`);
      return null;
    } catch (error) {
      this.logger.error(`Error getting cache for ${key}:`, error);
      return null;
    }
  }

  async set(
    source: SourceName,
    pair: Pair,
    quote: CachedQuote,
    ttl?: number,
  ): Promise<void> {
    const key = this.generateCacheKey(source, pair);

    try {
      const cacheTtl = ttl || this.sourcesManager.getTtl(source);

      const serializedQuote = {
        ...quote,
        receivedAt: quote.receivedAt.getTime(),
        cachedAt: quote.cachedAt.getTime(),
      };

      await this.cache.set(key, serializedQuote, cacheTtl);

      const now = new Date();
      const metadata: CacheMetadata = {
        source,
        pair,
        cachedAt: now,
        expiresAt: new Date(now.getTime() + cacheTtl),
        ttl: cacheTtl,
        lastRefreshed: now,
      };
      this.cacheMetadata.set(key, metadata);
      this.scheduleStaleCheck(key, metadata);
      this.updateCacheSizeMetrics();

      this.logger.verbose(`Cached quote for ${key} with TTL ${cacheTtl}ms`);
    } catch (error) {
      this.logger.error(`Error setting cache for ${key}:`, error);
    }
  }

  async del(source: SourceName, pair: Pair): Promise<void> {
    const key = this.generateCacheKey(source, pair);

    try {
      await this.cache.del(key);
      this.cacheMetadata.delete(key);
      if (this.stalenessTimers.has(key)) {
        clearTimeout(this.stalenessTimers.get(key)!);
        this.stalenessTimers.delete(key);
      }
      this.updateCacheSizeMetrics();

      this.logger.verbose(`Deleted cache for ${key}`);
    } catch (error) {
      this.logger.error(`Error deleting cache for ${key}:`, error);
    }
  }

  async clear(): Promise<void> {
    try {
      await this.cache.clear();
      this.cacheMetadata.clear();
      this.stalenessTimers.forEach((timer) => clearTimeout(timer));
      this.stalenessTimers.clear();

      this.logger.debug('Cache cleared');
    } catch (error) {
      this.logger.error('Error clearing cache:', error);
    }
  }

  private generateCacheKey(source: SourceName, pair: Pair): string {
    return `quote:${source}:${pair.join('/')}`;
  }

  private scheduleStaleCheck(key: string, metadata: CacheMetadata): void {
    if (this.stalenessTimers.has(key)) {
      clearTimeout(this.stalenessTimers.get(key)!);
    }

    const timeUntilStale =
      metadata.ttl - this.stalenessConfig.staleTriggerBeforeExpiry;
    if (timeUntilStale > 0) {
      this.stalenessTimers.set(
        key,
        setTimeout(() => this.handleStaleItem(key, metadata), timeUntilStale),
      );
    }
  }

  private handleStaleItem(key: string, metadata: CacheMetadata): void {
    const currentMetadata = this.cacheMetadata.get(key);
    if (!currentMetadata) return;

    const timeSinceLastRefresh = currentMetadata.lastRefreshed
      ? Date.now() - currentMetadata.lastRefreshed.getTime()
      : Infinity;

    if (timeSinceLastRefresh < this.stalenessConfig.minTimeBetweenRefreshes) {
      this.logger.debug(
        `Skipping stale notification for ${key}, recently refreshed ${timeSinceLastRefresh}ms ago`,
      );
      return;
    }

    this.pendingStaleBatch.push({
      source: metadata.source,
      pair: metadata.pair,
      expiresAt: metadata.expiresAt,
    });

    if (!this.batchTimer) {
      this.batchTimer = setTimeout(
        () => this.emitStaleBatch(),
        this.stalenessConfig.batchInterval,
      );
    }
  }

  private emitStaleBatch(): void {
    if (this.pendingStaleBatch.length === 0) {
      this.batchTimer = null;
      return;
    }

    const batch: StaleBatch = {
      items: [...this.pendingStaleBatch],
      timestamp: new Date(),
    };
    this.pendingStaleBatch = [];
    this.batchTimer = null;
    this.emit('stale-batch', batch);
    this.logger.debug(`Emitted stale batch with ${batch.items.length} items`);
  }

  onStaleBatch(callback: (batch: StaleBatch) => void): void {
    this.on('stale-batch', callback);
  }

  offStaleBatch(callback: (batch: StaleBatch) => void): void {
    this.off('stale-batch', callback);
  }

  configureStaleness(config: Partial<StalenessConfig>): void {
    Object.assign(this.stalenessConfig, config);
    this.logger.log('Updated staleness configuration', this.stalenessConfig);
  }

  getCacheMetadata(): Map<string, CacheMetadata> {
    return new Map(this.cacheMetadata);
  }

  private updateCacheSizeMetrics(): void {
    const sourceCounts = new Map<SourceName, number>();

    for (const key of this.cacheMetadata.keys()) {
      const [, sourcePart] = key.split(':');
      const source = sourcePart as SourceName;
      sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
    }

    for (const [source, count] of sourceCounts.entries()) {
      this.metricsService.cacheSize.set({ source }, count);
    }
  }
}
