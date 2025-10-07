import { EventEmitter } from 'events';

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

import {
  CacheMetadata,
  StaleItem,
  StaleBatch,
  StalenessConfig,
} from './cache-staleness.interface';
import { AppConfigService } from '../../config';
import { SourceName } from '../../sources';
import { Pair } from '../../sources/source-adapter.interface';

@Injectable()
export class CacheStalenessService
  extends EventEmitter
  implements OnModuleDestroy
{
  private readonly logger = new Logger(CacheStalenessService.name);
  private readonly metadata = new Map<string, CacheMetadata>();
  private readonly staleTimers = new Map<string, NodeJS.Timeout>();
  private pendingItems: StaleItem[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private config: StalenessConfig;

  constructor(config: AppConfigService) {
    super();
    this.config = {
      staleTriggerBeforeExpiry: config.get('refetch.staleTriggerBeforeExpiry'),
      batchInterval: config.get('refetch.batchInterval'),
      minTimeBetweenRefreshes: config.get('refetch.minTimeBetweenRefreshes'),
    };
  }

  onModuleDestroy(): void {
    this.clearAllTimers();
  }

  trackCacheEntry(
    key: string,
    source: SourceName,
    pair: Pair,
    ttl: number,
    staleTriggerBeforeExpiry: number,
  ): void {
    const now = new Date();
    const metadata: CacheMetadata = {
      source,
      pair,
      cachedAt: now,
      expiresAt: new Date(now.getTime() + ttl),
      ttl,
      staleTriggerBeforeExpiry,
      lastRefreshed: now,
    };

    this.metadata.set(key, metadata);
    this.scheduleStaleCheck(key, metadata);
  }

  removeEntry(key: string): void {
    this.metadata.delete(key);
    this.clearTimer(key);
  }

  updateRefreshTime(key: string): void {
    const metadata = this.metadata.get(key);
    if (metadata) {
      const now = new Date();
      metadata.lastRefreshed = now;
      metadata.cachedAt = now;
      metadata.expiresAt = new Date(now.getTime() + metadata.ttl);
      this.scheduleStaleCheck(key, metadata);
    }
  }

  clear(): void {
    this.metadata.clear();
    this.clearAllTimers();
    this.pendingItems = [];
  }

  getMetadata(): Map<string, CacheMetadata> {
    return new Map(this.metadata);
  }

  updateConfig(config: Partial<StalenessConfig>): void {
    Object.assign(this.config, config);
    this.logger.log('Updated staleness configuration', this.config);
  }

  private scheduleStaleCheck(key: string, metadata: CacheMetadata): void {
    this.clearTimer(key);

    const timeUntilStale = metadata.ttl - metadata.staleTriggerBeforeExpiry;
    if (timeUntilStale <= 0) {
      return;
    }

    const timer = setTimeout(() => {
      if (this.shouldNotifyStale(key)) {
        this.addToStaleBatch(metadata);
      }
    }, timeUntilStale);

    this.staleTimers.set(key, timer);
  }

  private shouldNotifyStale(key: string): boolean {
    const metadata = this.metadata.get(key);
    if (!metadata) {
      return false;
    }

    const timeSinceRefresh = Date.now() - metadata.lastRefreshed.getTime();
    return timeSinceRefresh >= this.config.minTimeBetweenRefreshes;
  }

  private addToStaleBatch(metadata: CacheMetadata): void {
    this.pendingItems.push({
      source: metadata.source,
      pair: metadata.pair,
      expiresAt: metadata.expiresAt,
    });

    if (!this.batchTimer) {
      this.batchTimer = setTimeout(
        () => this.emitBatch(),
        this.config.batchInterval,
      );
    }
  }

  private emitBatch(): void {
    if (this.pendingItems.length === 0) {
      this.batchTimer = null;
      return;
    }

    const batch: StaleBatch = {
      items: [...this.pendingItems],
      timestamp: new Date(),
    };

    this.pendingItems = [];
    this.batchTimer = null;

    this.emit('stale-batch', batch);
    this.logger.debug(`Emitted stale batch with ${batch.items.length} items`);
  }

  private clearTimer(key: string): void {
    const timer = this.staleTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.staleTimers.delete(key);
    }
  }

  private clearAllTimers(): void {
    this.staleTimers.forEach((timer) => clearTimeout(timer));
    this.staleTimers.clear();

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
  }
}
