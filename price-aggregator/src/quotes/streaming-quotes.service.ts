import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import { PairService } from './pair.service';
import { QuoteBatchProcessorService } from './quote-batch-processor.service';
import { formatPairLabel, parsePairLabel, SingleFlight } from '../common';
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
  private readonly initializedSources = new Set<SourceName>();

  private readonly pendingSubscriptions = new Map<SourceName, Set<string>>();
  private readonly subscriptionTimers = new Map<SourceName, NodeJS.Timeout>();

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
    private readonly metricsService: MetricsService,
    private readonly quoteBatchProcessor: QuoteBatchProcessorService,
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

        this.setupStreamReconnectionHandler(source, streamService);

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

          await this.subscribePairs(source, existingPairs);

          this.initializedSources.add(source);
        }
      } catch (error) {
        this.logger.debug(
          `Skipping streaming init for ${source}: ${String(error)}`,
        );
      }
    }

    this.handlePairAddedRef = async ({ pair, source }) => {
      await this.queuePairSubscription(source, pair);
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

    for (const timer of this.subscriptionTimers.values()) {
      clearTimeout(timer);
    }
    this.subscriptionTimers.clear();
    this.pendingSubscriptions.clear();

    await this.quoteBatchProcessor.flush();

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

  @SingleFlight(
    (source, pair) =>
      `${source}:${encodeURIComponent(pair[0])}|${encodeURIComponent(pair[1])}`,
  )
  private async subscribePair(source: SourceName, pair: Pair): Promise<void> {
    await this.subscribePairs(source, [pair]);
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
      this.quoteBatchProcessor.enqueueQuote(source, quote);
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

  private setupStreamReconnectionHandler(
    source: SourceName,
    streamService: QuoteStreamService,
  ): void {
    if ('onConnectionStateChange' in streamService) {
      (
        streamService as QuoteStreamService & {
          onConnectionStateChange: (
            handler: (connected: boolean) => void,
          ) => void;
        }
      ).onConnectionStateChange((connected: boolean) => {
        if (connected && this.initializedSources.has(source)) {
          this.logger.log(
            `Stream reconnected for ${source}, resubscribing pairs`,
          );
          this.resubscribeSourcePairs(source);
        }
      });
    }
  }

  private async resubscribeSourcePairs(source: SourceName): Promise<void> {
    const existingPairs = this.pairService.getPairsBySource(source);
    const subs = this.subscriptionsBySource.get(source);

    if (!subs || existingPairs.length === 0) return;

    subs.clear();

    await this.subscribePairs(source, existingPairs);
  }

  private getPairKey(pair: Pair): string {
    return formatPairLabel(pair);
  }

  private async subscribePairs(
    source: SourceName,
    pairs: Pair[],
  ): Promise<void> {
    const streamService = this.streamServiceBySource.get(source);
    if (!streamService || pairs.length === 0) return;

    const subs = this.ensureSubsMap(source);

    const pairsToSubscribe: Pair[] = [];
    for (const pair of pairs) {
      const pairKey = this.getPairKey(pair);
      if (subs.has(pairKey)) {
        this.logger.verbose(
          `Already have subscription for ${source}:${pairKey}, skipping`,
        );
        continue;
      }
      pairsToSubscribe.push(pair);
    }

    if (pairsToSubscribe.length === 0) return;

    const pairKeys = pairsToSubscribe.map((pair) => this.getPairKey(pair));
    this.logger.debug(
      `Subscribing to ${source}: ${pairKeys.length} pair(s) [${pairKeys.join(', ')}]`,
    );

    try {
      const subscriptions = await streamService.subscribeMany(
        pairsToSubscribe,
        (quote) => this.handleQuote(source, quote),
        (pair) => (error) => this.handleStreamError(source, pair, error),
      );

      subscriptions.forEach((subscription) => {
        const key = this.getPairKey(subscription.pair);
        subs.set(key, subscription);
      });

      this.initializedSources.add(source);
      this.logger.log(
        `Subscribed to ${source}: ${pairKeys.length} pair(s) [${pairKeys.join(', ')}]`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to subscribe to ${source}: ${pairKeys.join(', ')}`,
        error as Error,
      );
    }
  }

  private async queuePairSubscription(
    source: SourceName,
    pair: Pair,
  ): Promise<void> {
    const pairKey = this.getPairKey(pair);

    const subs = this.subscriptionsBySource.get(source);
    if (subs?.has(pairKey)) {
      this.logger.verbose(`Already subscribed to ${source}:${pairKey}`);
      return;
    }

    if (!this.pendingSubscriptions.has(source)) {
      this.pendingSubscriptions.set(source, new Set());
    }
    const pending = this.pendingSubscriptions.get(source)!;
    pending.add(pairKey);

    this.logger.debug(
      `Queued subscription for ${source}:${pairKey} (${pending.size} pending)`,
    );

    const existingTimer = this.subscriptionTimers.get(source);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      await this.processPendingSubscriptions(source);
    }, 100);

    this.subscriptionTimers.set(source, timer);
  }

  private async processPendingSubscriptions(source: SourceName): Promise<void> {
    const pending = this.pendingSubscriptions.get(source);
    if (!pending || pending.size === 0) return;

    const pairKeys = Array.from(pending);
    const pairs: Pair[] = pairKeys.map((pairLabel) =>
      parsePairLabel(pairLabel),
    );

    pending.clear();
    this.subscriptionTimers.delete(source);

    this.logger.debug(
      `Processing ${pairs.length} pending subscriptions for ${source}`,
    );

    try {
      await this.subscribePairs(source, pairs);
    } catch (error) {
      this.logger.error(
        `Failed to process pending subscriptions for ${source}`,
        error as Error,
      );
    }
  }
}
