import { Injectable, Logger } from '@nestjs/common';
import { createCache, Cache } from 'cache-manager';

import { CachedQuote, SerializedCachedQuote } from './cache.interface';
import { SourceName } from '../../sources';
import { Pair } from '../../sources/source-adapter.interface';
import { SourcesManagerService } from '../../sources/sources-manager.service';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private cache: Cache;

  constructor(private readonly sourcesManager: SourcesManagerService) {
    this.cache = createCache({
      ttl: 60 * 1000,
    });
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

      this.logger.debug(`Cached quote for ${key} with TTL ${cacheTtl}ms`);
    } catch (error) {
      this.logger.error(`Error setting cache for ${key}:`, error);
    }
  }

  async del(source: SourceName, pair: Pair): Promise<void> {
    const key = this.generateCacheKey(source, pair);

    try {
      await this.cache.del(key);
      this.logger.debug(`Deleted cache for ${key}`);
    } catch (error) {
      this.logger.error(`Error deleting cache for ${key}:`, error);
    }
  }

  async clear(): Promise<void> {
    try {
      await this.cache.clear();
      this.logger.debug('Cache cleared');
    } catch (error) {
      this.logger.error('Error clearing cache:', error);
    }
  }

  private generateCacheKey(source: SourceName, pair: Pair): string {
    return `quote:${source}:${pair.join('/')}`;
  }
}
