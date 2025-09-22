import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import PQueue from 'p-queue';

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
  private refreshQueue: PQueue;
  private inProgressKeys = new Set<string>();
  private config: RefetchConfig;

  constructor(
    private readonly configService: AppConfigService,
    private readonly cacheService: CacheService,
    private readonly sourcesManager: SourcesManagerService,
    private readonly pairService: PairService,
  ) {
    this.config = this.configService.get('refetch');
    this.refreshQueue = new PQueue({
      concurrency: this.config.maxConcurrentRefreshes,
    });
  }

  onModuleInit(): void {
    if (!this.config.enabled) {
      this.logger.log('Refetch service is disabled');
      return;
    }

    this.cacheService.onStaleBatch((batch) => this.handleStaleBatch(batch));

    this.logger.log('Refetch service initialized with config:', this.config);
  }

  onModuleDestroy(): void {
    if (!this.config.enabled) {
      return;
    }

    this.cacheService.offStaleBatch((batch) => this.handleStaleBatch(batch));
    this.logger.log('Refetch service destroyed');
  }

  private async handleStaleBatch(batch: StaleBatch): Promise<void> {
    const startTime = Date.now();

    const validItems = batch.items.filter((item) => {
      const key = this.getRefreshKey(item.source, item.pair);

      if (this.inProgressKeys.has(key)) {
        this.logger.debug(`Skipping ${key}, already in progress`);
        return false;
      }

      if (!this.isRefreshable(item.source, item.pair)) {
        return false;
      }

      this.inProgressKeys.add(key);
      return true;
    });

    if (validItems.length === 0) {
      this.logger.debug('No new items to refresh');
      return;
    }

    const grouped = this.groupBySource(validItems);

    const sourceStats = Array.from(grouped.entries())
      .map(([source, pairs]) => `${source}:${pairs.length}`)
      .join(', ');

    this.logger.log(
      `Processing stale batch: ${validItems.length} items across ${grouped.size} sources [${sourceStats}]`,
    );

    await Promise.all(
      Array.from(grouped.entries()).map(([source, pairs]) =>
        this.refreshQueue
          .add(() => this.refreshSourcePairs(source, pairs))
          .finally(() => {
            pairs.forEach((pair) => {
              this.inProgressKeys.delete(this.getRefreshKey(source, pair));
            });
          }),
      ),
    );

    const duration = Date.now() - startTime;
    this.logger.log(
      `Completed stale batch processing: ${validItems.length} items in ${duration}ms`,
    );
  }

  private isRefreshable(source: SourceName, pair: Pair): boolean {
    if (!this.pairService.getSourcesByPair(pair).includes(source)) {
      return false;
    }
    return this.sourcesManager.isRefetchEnabled(source);
  }

  private groupBySource(
    items: Array<{ source: SourceName; pair: Pair }>,
  ): Map<SourceName, Pair[]> {
    const grouped = new Map<SourceName, Pair[]>();
    items.forEach(({ source, pair }) => {
      const pairs = grouped.get(source) || [];
      pairs.push(pair);
      grouped.set(source, pairs);
    });
    return grouped;
  }

  private getRefreshKey(source: SourceName, pair: Pair): string {
    return `${source}:${pair.join('/')}`;
  }

  private async refreshSourcePairs(
    source: SourceName,
    pairs: Pair[],
  ): Promise<void> {
    const startTime = Date.now();
    this.logger.debug(
      `Starting refresh for ${source}: ${pairs.length} pairs [${pairs.map((p) => p.join('/')).join(', ')}]`,
    );

    try {
      const quotes = await this.fetchQuotes(source, pairs);
      await Promise.all(quotes.map((quote) => this.cacheQuote(source, quote)));

      const duration = Date.now() - startTime;
      this.logger.log(
        `Successfully refreshed ${quotes.length}/${pairs.length} pairs for ${source} in ${duration}ms`,
      );
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `Error refreshing ${pairs.length} pairs for ${source} after ${duration}ms: ${String(error)}`,
      );
    }
  }

  private splitIntoBatches(pairs: Pair[], maxBatchSize: number): Pair[][] {
    const batches: Pair[][] = [];
    for (let i = 0; i < pairs.length; i += maxBatchSize) {
      batches.push(pairs.slice(i, i + maxBatchSize));
    }
    return batches;
  }

  private async fetchQuotes(
    source: SourceName,
    pairs: Pair[],
  ): Promise<Quote[]> {
    const supportsBatch = this.sourcesManager.isFetchQuotesSupported(source);

    if (supportsBatch && pairs.length > 1) {
      const maxBatchSize = this.sourcesManager.getMaxBatchSize(source);

      if (pairs.length <= maxBatchSize) {
        return this.sourcesManager.fetchQuotes(source, pairs);
      }

      const batches = this.splitIntoBatches(pairs, maxBatchSize);
      this.logger.debug(
        `Splitting ${pairs.length} pairs into ${batches.length} batches for ${source} (max: ${maxBatchSize})`,
      );

      const batchPromises = batches.map(async (batch, index) => {
        try {
          return await this.sourcesManager.fetchQuotes(source, batch);
        } catch (error) {
          this.logger.error(
            `Batch ${index + 1}/${batches.length} failed for ${source}: ${String(error)}`,
          );
          return [];
        }
      });

      const results = await Promise.allSettled(batchPromises);
      const allQuotes = results
        .filter(
          (result): result is PromiseFulfilledResult<Quote[]> =>
            result.status === 'fulfilled',
        )
        .flatMap((result) => result.value);

      return allQuotes;
    }

    const quotes = await Promise.allSettled(
      pairs.map((pair) => this.sourcesManager.fetchQuote(source, pair)),
    );

    return quotes
      .filter(
        (result): result is PromiseFulfilledResult<Quote> =>
          result.status === 'fulfilled',
      )
      .map((result) => result.value);
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

  getRefreshStatus(): {
    enabled: boolean;
    config: RefetchConfig;
    queue: {
      size: number;
      pending: number;
      isPaused: boolean;
    };
    inProgress: string[];
  } {
    return {
      enabled: this.config.enabled,
      config: this.config,
      queue: {
        size: this.refreshQueue.size,
        pending: this.refreshQueue.pending,
        isPaused: this.refreshQueue.isPaused,
      },
      inProgress: Array.from(this.inProgressKeys),
    };
  }

  async manualRefresh(source: SourceName, pairs: Pair[]): Promise<void> {
    if (!this.config.enabled) {
      throw new Error('Refetch service is disabled');
    }

    this.logger.log(
      `Manual refresh triggered for ${pairs.length} pairs from ${source}`,
    );

    await this.refreshQueue.add(() => this.refreshSourcePairs(source, pairs));
  }
}
