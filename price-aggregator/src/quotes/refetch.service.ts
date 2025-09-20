import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';

import { CacheService, StaleBatch } from './cache';
import { SourceName } from '../sources';
import { PairService } from './pair.service';
import { AppConfigService } from '../config/config.service';
import { Pair, Quote } from '../sources/source-adapter.interface';
import { SourcesManagerService } from '../sources/sources-manager.service';

export interface RefetchConfig {
  enabled: boolean;
  staleTriggerBeforeExpiry: number;
  batchInterval: number;
  minTimeBetweenRefreshes: number;
  maxConcurrentRefreshes: number;
}

@Injectable()
export class RefetchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RefetchService.name);
  private staleBatchHandler: (batch: StaleBatch) => void;
  private refreshInProgress = new Set<string>();
  private config: RefetchConfig;

  constructor(
    private readonly configService: AppConfigService,
    private readonly cacheService: CacheService,
    private readonly sourcesManager: SourcesManagerService,
    private readonly pairService: PairService,
  ) {
    this.staleBatchHandler = this.handleStaleBatch.bind(this);
    this.config = this.configService.get('refetch');
  }

  onModuleInit(): void {
    if (!this.config.enabled) {
      this.logger.log('Refetch service is disabled');
      return;
    }

    this.cacheService.onStaleBatch(this.staleBatchHandler);
    this.cacheService.configureStaleness({
      staleTriggerBeforeExpiry: this.config.staleTriggerBeforeExpiry,
      batchInterval: this.config.batchInterval,
      minTimeBetweenRefreshes: this.config.minTimeBetweenRefreshes,
    });

    this.logger.log('Refetch service initialized with config:', this.config);
  }

  onModuleDestroy(): void {
    if (!this.config.enabled) {
      return;
    }

    this.cacheService.offStaleBatch(this.staleBatchHandler);
    this.logger.log('Refetch service destroyed');
  }

  private async handleStaleBatch(batch: StaleBatch): Promise<void> {
    const startTime = Date.now();

    this.logger.debug(
      `Received stale batch with ${batch.items.length} items at ${batch.timestamp.toISOString()}`,
    );

    const itemsToRefresh = batch.items.filter((item) => {
      const key = this.generateRefreshKey(item.source, item.pair);

      const registeredSources = this.pairService.getSourcesByPair(item.pair);
      if (!registeredSources.includes(item.source)) {
        this.logger.debug(`Skipping ${key}, pair no longer registered`);
        return false;
      }

      if (this.refreshInProgress.has(key)) {
        this.logger.debug(`Skipping ${key}, refresh already in progress`);
        return false;
      }

      this.refreshInProgress.add(key);
      return true;
    });

    if (itemsToRefresh.length === 0) {
      this.logger.debug('No items to refresh (all already in progress)');
      return;
    }

    const itemsBySource = this.groupItemsBySource(itemsToRefresh);
    await this.processRefreshBatches(itemsBySource);

    itemsToRefresh.forEach((item) => {
      const key = this.generateRefreshKey(item.source, item.pair);
      this.refreshInProgress.delete(key);
    });

    const sources = Array.from(itemsBySource.keys());
    const duration = Date.now() - startTime;
    this.logger.log(
      `Completed proactive refresh for ${itemsToRefresh.length}/${batch.items.length} items from [${sources.join(', ')}] in ${duration}ms`,
    );
  }

  private groupItemsBySource(
    items: Array<{ source: SourceName; pair: Pair }>,
  ): Map<SourceName, Pair[]> {
    const itemsBySource = new Map<SourceName, Pair[]>();

    for (const item of items) {
      const pairs = itemsBySource.get(item.source) || [];
      pairs.push(item.pair);
      itemsBySource.set(item.source, pairs);
    }

    return itemsBySource;
  }

  private async processRefreshBatches(
    itemsBySource: Map<SourceName, Pair[]>,
  ): Promise<void> {
    const sources = Array.from(itemsBySource.entries());
    for (
      let i = 0;
      i < sources.length;
      i += this.config.maxConcurrentRefreshes
    ) {
      await Promise.all(
        sources
          .slice(i, i + this.config.maxConcurrentRefreshes)
          .map(([source, pairs]) => this.refreshSourcePairs(source, pairs)),
      );
    }
  }

  private async refreshSourcePairs(
    source: SourceName,
    pairs: Pair[],
  ): Promise<void> {
    try {
      if (
        this.sourcesManager.isFetchQuotesSupported(source) &&
        pairs.length > 1
      ) {
        this.logger.debug(
          `Proactively refreshing ${pairs.length} stale pairs for ${source} using batch`,
        );
        await Promise.all(
          (await this.sourcesManager.fetchQuotes(source, pairs)).map((quote) =>
            this.cacheQuote(source, quote),
          ),
        );
      } else {
        await this.refreshIndividualPairs(source, pairs);
      }
    } catch (error) {
      this.logger.error(
        `Error refreshing stale pairs for ${source}: ${String(error)}`,
      );
    }
  }

  private async refreshIndividualPairs(
    source: SourceName,
    pairs: Pair[],
  ): Promise<void> {
    this.logger.debug(
      `Proactively refreshing ${pairs.length} stale pairs for ${source} individually`,
    );

    await Promise.all(
      pairs.map(async (pair) => {
        try {
          await this.cacheQuote(
            source,
            await this.sourcesManager.fetchQuote(source, pair),
          );
        } catch (error) {
          this.logger.warn(
            `Failed to refresh stale pair ${pair.join('/')} from ${source}: ${String(error)}`,
          );
        }
      }),
    );
  }

  private async cacheQuote(source: SourceName, quote: Quote): Promise<void> {
    await this.cacheService.set(source, quote.pair, {
      ...quote,
      source,
      cachedAt: new Date(),
    });
    this.pairService.trackSuccessfulFetch(quote.pair, source);
    this.pairService.trackResponse(quote.pair, source);
  }

  private generateRefreshKey(source: SourceName, pair: Pair): string {
    return `${source}:${pair.join('/')}`;
  }

  getRefreshStatus(): {
    enabled: boolean;
    config: RefetchConfig;
    refreshInProgress: string[];
  } {
    return {
      enabled: this.config.enabled,
      config: this.config,
      refreshInProgress: Array.from(this.refreshInProgress),
    };
  }

  async manualRefresh(source: SourceName, pairs: Pair[]): Promise<void> {
    if (!this.config.enabled) {
      throw new Error('Refetch service is disabled');
    }

    this.logger.log(
      `Manual refresh triggered for ${pairs.length} pairs from ${source}`,
    );

    await this.refreshSourcePairs(source, pairs);
  }
}
