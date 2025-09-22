import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createCache, Cache } from 'cache-manager';

import { StaleBatch } from './cache-staleness.interface';
import { CacheStalenessService } from './cache-staleness.service';
import { CachedQuote, SerializedCachedQuote } from './cache.interface';
import { AppConfigService } from '../../config/config.service';
import { MetricsService } from '../../metrics/metrics.service';
import { SourceName } from '../../sources';
import { Pair } from '../../sources/source-adapter.interface';
import { SourcesManagerService } from '../../sources/sources-manager.service';

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private cache: Cache;
  private pairTtlCache = new Map<string, number | null>();

  constructor(
    private readonly sourcesManager: SourcesManagerService,
    private readonly configService: AppConfigService,
    private readonly metricsService: MetricsService,
    private readonly stalenessService: CacheStalenessService,
  ) {
    this.cache = createCache({
      ttl: 60000,
    });
    this.updateCacheSizeMetrics();
  }

  onModuleDestroy(): void {
    this.pairTtlCache.clear();
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
      const cacheTtl =
        ttl ||
        this.getPairSpecificTtl(source, pair) ||
        this.sourcesManager.getTtl(source);

      const serializedQuote = {
        ...quote,
        receivedAt: quote.receivedAt.getTime(),
        cachedAt: quote.cachedAt.getTime(),
      };

      await this.cache.set(key, serializedQuote, cacheTtl);
      this.stalenessService.trackCacheEntry(key, source, pair, cacheTtl);
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
      this.stalenessService.removeEntry(key);
      this.updateCacheSizeMetrics();

      this.logger.verbose(`Deleted cache for ${key}`);
    } catch (error) {
      this.logger.error(`Error deleting cache for ${key}:`, error);
    }
  }

  async clear(): Promise<void> {
    try {
      await this.cache.clear();
      this.stalenessService.clear();
      this.logger.debug('Cache cleared');
    } catch (error) {
      this.logger.error('Error clearing cache:', error);
    }
  }

  private generateCacheKey(source: SourceName, pair: Pair): string {
    return `quote:${source}:${pair.join('/')}`;
  }

  onStaleBatch(callback: (batch: StaleBatch) => void): void {
    this.stalenessService.on('stale-batch', callback);
  }

  offStaleBatch(callback: (batch: StaleBatch) => void): void {
    this.stalenessService.off('stale-batch', callback);
  }

  updateEntryRefreshTime(source: SourceName, pair: Pair): void {
    const key = this.generateCacheKey(source, pair);
    this.stalenessService.updateRefreshTime(key);
  }

  clearPairTtlCache(): void {
    this.pairTtlCache.clear();
    this.logger.debug('Pair TTL cache cleared');
  }

  private getPairSpecificTtl(source: SourceName, pair: Pair): number | null {
    const cacheKey = `${source}:${pair.join('/')}`;

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

    const ttl = pairConfig?.ttl || null;
    this.pairTtlCache.set(cacheKey, ttl);
    return ttl;
  }

  private updateCacheSizeMetrics(): void {
    const metadata = this.stalenessService.getMetadata();
    const sourceCounts = new Map<SourceName, number>();

    for (const key of metadata.keys()) {
      const [, sourcePart] = key.split(':');
      const source = sourcePart as SourceName;
      sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
    }

    for (const [source, count] of sourceCounts.entries()) {
      this.metricsService.cacheSize.set({ source }, count);
    }
  }
}
