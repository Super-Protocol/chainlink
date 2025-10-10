import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as NodeCache from 'node-cache';

import { StaleBatch } from './cache-staleness.interface';
import { CacheStalenessService } from './cache-staleness.service';
import { CachedQuote, SerializedCachedQuote } from './cache.interface';
import { formatPairLabel } from '../../common';
import { AppConfigService } from '../../config/config.service';
import { MetricsService } from '../../metrics/metrics.service';
import { SourceName } from '../../sources';
import { Pair } from '../../sources/source-adapter.interface';
import { SourcesManagerService } from '../../sources/sources-manager.service';

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private cache: NodeCache;
  private pairTtlCache = new Map<string, number | null>();
  private metricsUpdateInterval: NodeJS.Timeout;
  private metricsUpdateScheduled = false;

  constructor(
    private readonly sourcesManager: SourcesManagerService,
    private readonly configService: AppConfigService,
    private readonly metricsService: MetricsService,
    private readonly stalenessService: CacheStalenessService,
  ) {
    this.cache = new NodeCache({
      stdTTL: 60,
      checkperiod: 10,
      useClones: false,
    });

    this.setupCacheEventListeners();
    this.updateCacheSizeMetrics();
  }

  onModuleDestroy(): void {
    if (this.metricsUpdateInterval) {
      clearInterval(this.metricsUpdateInterval);
    }
    this.pairTtlCache.clear();
  }

  private setupCacheEventListeners(): void {
    const handleCacheRemoval = (key: string, event: string) => {
      this.logger.debug(`Cache key ${event}: ${key}`);
      this.stalenessService.removeEntry(key);
      this.scheduleMetricsUpdate();
    };

    this.cache.on('expired', (key: string) =>
      handleCacheRemoval(key, 'expired'),
    );
    this.cache.on('del', (key: string) => handleCacheRemoval(key, 'deleted'));
  }

  async get(source: SourceName, pair: Pair): Promise<CachedQuote | null> {
    const key = this.generateCacheKey(source, pair);

    try {
      const cached = this.cache.get<SerializedCachedQuote>(key);

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

  async set(quote: CachedQuote, ttl?: number): Promise<void> {
    const { source, pair } = quote;
    const key = this.generateCacheKey(source, pair);

    try {
      const cacheTtlMs = this.resolveTtl(source, pair, ttl);
      const serializedQuote = this.serializeQuote(quote);
      const staleTriggerBeforeExpiry =
        this.resolveStaleTriggerBeforeExpiry(source);

      this.cache.set(key, serializedQuote, Math.floor(cacheTtlMs / 1000));
      this.stalenessService.trackCacheEntry(
        key,
        source,
        pair,
        cacheTtlMs,
        staleTriggerBeforeExpiry,
      );
      this.scheduleMetricsUpdate();
      this.logger.verbose(`Cached quote for ${key} with TTL ${cacheTtlMs}ms`);
    } catch (error) {
      this.logger.error(`Error setting cache for ${key}:`, error);
    }
  }

  async setMany(quotes: CachedQuote[]): Promise<void> {
    const entriesToSet: Array<{
      key: string;
      value: SerializedCachedQuote;
      ttl: number;
      source: SourceName;
      pair: Pair;
      cacheTtlMs: number;
      staleTriggerBeforeExpiry: number;
    }> = [];

    for (const quote of quotes) {
      const { source, pair } = quote;
      const key = this.generateCacheKey(source, pair);
      const cacheTtlMs = this.resolveTtl(source, pair);
      const serializedQuote = this.serializeQuote(quote);
      const staleTriggerBeforeExpiry =
        this.resolveStaleTriggerBeforeExpiry(source);

      entriesToSet.push({
        key,
        value: serializedQuote,
        ttl: Math.floor(cacheTtlMs / 1000),
        source,
        pair,
        cacheTtlMs,
        staleTriggerBeforeExpiry,
      });
    }

    try {
      for (const entry of entriesToSet) {
        this.cache.set(entry.key, entry.value, entry.ttl);
        this.stalenessService.trackCacheEntry(
          entry.key,
          entry.source,
          entry.pair,
          entry.cacheTtlMs,
          entry.staleTriggerBeforeExpiry,
        );
      }
      this.scheduleMetricsUpdate();
      this.logger.verbose(`Batch cached ${quotes.length} quotes`);
    } catch (error) {
      this.logger.error('Error batch setting cache:', error);
    }
  }

  async del(source: SourceName, pair: Pair): Promise<void> {
    const key = this.generateCacheKey(source, pair);

    try {
      const affected = this.cache.del(key);
      if (affected > 0) {
        this.logger.verbose(`Deleted cache for ${key}`);
      }
    } catch (error) {
      this.logger.error(`Error deleting cache for ${key}:`, error);
    }
  }

  async clear(): Promise<void> {
    try {
      this.cache.flushAll();
      this.stalenessService.clear();
      this.logger.debug('Cache cleared');
    } catch (error) {
      this.logger.error('Error clearing cache:', error);
    }
  }

  private generateCacheKey(source: SourceName, pair: Pair): string {
    return `quote:${source}:${formatPairLabel(pair)}`;
  }

  private resolveTtl(source: SourceName, pair: Pair, ttl?: number): number {
    return (
      ttl ??
      this.getPairSpecificTtl(source, pair) ??
      this.sourcesManager.getTtl(source)
    );
  }

  private resolveStaleTriggerBeforeExpiry(source: SourceName): number {
    return (
      this.sourcesManager.getStaleTriggerBeforeExpiry(source) ??
      this.configService.get('refetch.staleTriggerBeforeExpiry')
    );
  }

  private serializeQuote(quote: CachedQuote): SerializedCachedQuote {
    return {
      ...quote,
      receivedAt: quote.receivedAt.getTime(),
      cachedAt: quote.cachedAt.getTime(),
    };
  }

  onStaleBatch(callback: (batch: StaleBatch) => void): void {
    this.stalenessService.on('stale-batch', callback);
  }

  offStaleBatch(callback: (batch: StaleBatch) => void): void {
    this.stalenessService.off('stale-batch', callback);
  }

  private getPairSpecificTtl(source: SourceName, pair: Pair): number | null {
    const cacheKey = this.generateCacheKey(source, pair);

    if (this.pairTtlCache.has(cacheKey)) {
      return this.pairTtlCache.get(cacheKey)!;
    }

    const pairsTtlConfig = this.configService.get('pairsTtl');
    if (!pairsTtlConfig || !Array.isArray(pairsTtlConfig)) {
      this.pairTtlCache.set(cacheKey, null);
      return null;
    }

    const pairConfig = pairsTtlConfig.find(
      (config) =>
        (!config.source || config.source === source) &&
        Array.isArray(config.pair) &&
        config.pair.length === 2 &&
        config.pair[0] === pair[0] &&
        config.pair[1] === pair[1],
    );

    const ttl = pairConfig?.ttl ?? null;
    this.pairTtlCache.set(cacheKey, ttl);
    return ttl;
  }

  private scheduleMetricsUpdate(): void {
    if (!this.metricsUpdateScheduled) {
      this.metricsUpdateScheduled = true;
      setTimeout(() => {
        this.updateCacheSizeMetrics();
        this.metricsUpdateScheduled = false;
      }, 100);
    }
  }

  private updateCacheSizeMetrics(): void {
    const sourceCounts = Object.values(SourceName).reduce(
      (acc, source) => acc.set(source, 0),
      new Map<SourceName, number>(),
    );

    this.cache.keys().forEach((key) => {
      const source = key.split(':')[1] as SourceName;
      sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
    });

    sourceCounts.forEach((count, source) => {
      this.metricsService.cacheSize.set({ source }, count);
    });
  }
}
