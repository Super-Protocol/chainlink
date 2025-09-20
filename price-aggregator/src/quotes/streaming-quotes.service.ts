import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import { CacheService, CachedQuote } from './cache';
import { PairService } from './pair.service';
import { MetricsService } from '../metrics/metrics.service';
import { SourceName } from '../sources';
import {
  QuoteStreamService,
  StreamSubscription,
} from '../sources/quote-stream.interface';
import { Pair, Quote } from '../sources/source-adapter.interface';
import { SourcesManagerService } from '../sources/sources-manager.service';

@Injectable()
export class StreamingQuotesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StreamingQuotesService.name);
  private readonly streamServiceBySource = new Map<
    SourceName,
    QuoteStreamService
  >();
  private readonly subscriptionsBySource = new Map<
    SourceName,
    Map<string, StreamSubscription>
  >();

  private handlePairAddedRef?: (event: {
    pair: Pair;
    source: SourceName;
  }) => void;
  private handlePairRemovedRef?: (event: {
    pair: Pair;
    source: SourceName;
  }) => void;

  constructor(
    private readonly sourcesManager: SourcesManagerService,
    private readonly pairService: PairService,
    private readonly cacheService: CacheService,
    private readonly metricsService: MetricsService,
  ) {}

  async onModuleInit(): Promise<void> {
    const streamingSources = this.sourcesManager.getStreamingSources();
    this.logger.log(
      `Initializing streaming for ${streamingSources.length} sources: ${streamingSources.join(', ')}`,
    );

    for (const source of streamingSources) {
      try {
        const streamService = this.sourcesManager.getStreamService(source);
        this.streamServiceBySource.set(source, streamService);
        this.subscriptionsBySource.set(source, new Map());

        const existingPairs = this.pairService.getPairsBySource(source);
        if (existingPairs.length > 0) {
          try {
            await streamService.connect();
            this.logger.log(`Connected to stream for ${source}`);
          } catch (error) {
            this.logger.error(
              `Failed to connect stream for ${source}`,
              error as Error,
            );
          }

          for (const pair of existingPairs) {
            await this.subscribePair(source, pair);
          }
        }
      } catch (error) {
        this.logger.debug(
          `Skipping streaming init for ${source}: ${String(error)}`,
        );
      }
    }

    this.handlePairAddedRef = async ({ pair, source }) => {
      await this.subscribePair(source, pair);
    };
    this.handlePairRemovedRef = async ({ pair, source }) => {
      await this.unsubscribePair(source, pair);
    };

    this.pairService.on('pair-added', this.handlePairAddedRef);
    this.pairService.on('pair-removed', this.handlePairRemovedRef);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.handlePairAddedRef)
      this.pairService.off('pair-added', this.handlePairAddedRef);
    if (this.handlePairRemovedRef)
      this.pairService.off('pair-removed', this.handlePairRemovedRef);

    for (const [source, streamService] of this.streamServiceBySource) {
      try {
        await streamService.unsubscribeAll();
        await streamService.disconnect();
      } catch (error) {
        this.logger.debug(
          `Error during teardown for ${source}: ${String(error)}`,
        );
      }
    }
    this.streamServiceBySource.clear();
    this.subscriptionsBySource.clear();
  }

  private async subscribePair(source: SourceName, pair: Pair): Promise<void> {
    const streamService = this.streamServiceBySource.get(source);
    if (!streamService) return;

    const pairKey = this.getPairKey(pair);
    const subs = this.ensureSubsMap(source);
    if (subs.has(pairKey)) return;

    try {
      if (!streamService.isConnected) {
        await streamService.connect();
      }
      const subscription = await streamService.subscribe(
        pair,
        (quote) => this.handleQuote(source, quote),
        (error) => this.handleStreamError(source, pair, error),
      );
      subs.set(pairKey, subscription);
      this.logger.log(`Subscribed to ${source}:${pairKey}`);
    } catch (error) {
      this.logger.error(
        `Failed to subscribe ${source}:${pairKey}`,
        error as Error,
      );
    }
  }

  private async unsubscribePair(source: SourceName, pair: Pair): Promise<void> {
    const subs = this.subscriptionsBySource.get(source);
    if (!subs) return;
    const pairKey = this.getPairKey(pair);
    const subscription = subs.get(pairKey);
    if (!subscription) return;

    try {
      await subscription.unsubscribe();
    } catch (error) {
      this.logger.debug(
        `Unsubscribe error for ${source}:${pairKey}: ${String(error)}`,
      );
    } finally {
      subs.delete(pairKey);
    }
  }

  private async handleQuote(source: SourceName, quote: Quote): Promise<void> {
    try {
      const cached: CachedQuote = {
        source,
        pair: quote.pair,
        price: quote.price,
        receivedAt: quote.receivedAt,
        cachedAt: new Date(),
      };
      await this.cacheService.set(source, quote.pair, cached);
      this.pairService.trackSuccessfulFetch(quote.pair, source);
      this.metricsService.quoteThroughput.inc({ source, status: 'success' });
    } catch (error) {
      this.metricsService.quoteThroughput.inc({ source, status: 'error' });
      this.logger.error(
        `Error handling quote for ${source}:${this.getPairKey(quote.pair)}`,
        error as Error,
      );
    }
  }

  private handleStreamError(
    source: SourceName,
    pair: Pair,
    error?: Error,
  ): void {
    this.logger.warn(
      `Stream error for ${source}:${this.getPairKey(pair)}: ${String(error)}`,
    );
  }

  private ensureSubsMap(source: SourceName): Map<string, StreamSubscription> {
    if (!this.subscriptionsBySource.has(source)) {
      this.subscriptionsBySource.set(source, new Map());
    }
    return this.subscriptionsBySource.get(source)!;
  }

  private getPairKey(pair: Pair): string {
    return pair.join('/');
  }
}
