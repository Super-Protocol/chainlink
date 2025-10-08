import { Injectable, Logger } from '@nestjs/common';

import { CacheService, CachedQuote } from './cache';
import { QuoteResponseDto } from './dto';
import { PairService } from './pair.service';
import { formatPairLabel } from '../common';
import { MetricsService } from '../metrics/metrics.service';
import { SourceName } from '../sources';
import { PriceNotFoundException } from '../sources/exceptions';
import { Pair, Quote } from '../sources/source-adapter.interface';
import { SourcesManagerService } from '../sources/sources-manager.service';

@Injectable()
export class BatchQuotesService {
  private readonly logger = new Logger(BatchQuotesService.name);

  constructor(
    private readonly sourcesManager: SourcesManagerService,
    private readonly pairService: PairService,
    private readonly cacheService: CacheService,
    private readonly metricsService: MetricsService,
  ) {}

  private createCachedQuote(source: SourceName, quote: Quote): CachedQuote {
    return { ...quote, source, cachedAt: new Date() };
  }

  private createQuoteResponse(
    source: SourceName,
    quote: Quote,
  ): QuoteResponseDto {
    return { ...quote, source };
  }

  private async cacheAndTrackQuote(
    source: SourceName,
    quote: Quote,
  ): Promise<void> {
    await this.cacheService.set(this.createCachedQuote(source, quote));
    this.pairService.trackSuccessfulFetch(quote.pair, source);
    this.pairService.trackResponse(quote.pair, source);
    this.metricsService.updateSourceLastUpdate(source, quote.pair);
  }

  private async processBatchQuotes(
    source: SourceName,
    quotes: Quote[],
    requestedPair: Pair,
  ): Promise<QuoteResponseDto | null> {
    const requestedPairKey = formatPairLabel(requestedPair);

    for (const quote of quotes) {
      await this.cacheAndTrackQuote(source, quote);
    }

    const requestedQuote = quotes.find(
      (q) => formatPairLabel(q.pair) === requestedPairKey,
    );
    return requestedQuote
      ? this.createQuoteResponse(source, requestedQuote)
      : null;
  }

  buildBatch(source: SourceName, pair: Pair): Pair[] {
    const requestedPairKey = formatPairLabel(pair);
    const batch = [pair];

    const maxBatchSize = this.sourcesManager.getMaxBatchSize(source);

    const registrations =
      this.pairService.getPairsBySourceWithTimestamps(source);

    const sortedByOldest = registrations.sort(
      (a, b) => a.lastFetchAt.getTime() - b.lastFetchAt.getTime(),
    );

    for (const registration of sortedByOldest) {
      if (formatPairLabel(registration.pair) === requestedPairKey) continue;
      batch.push(registration.pair);
      if (batch.length >= maxBatchSize) break;
    }

    this.logger.debug(
      `Built batch of ${batch.length} for ${source} (max: ${maxBatchSize}), requested ${requestedPairKey}`,
    );

    return batch;
  }

  async fetchWithBatch(
    source: SourceName,
    pair: Pair,
    batch: Pair[],
  ): Promise<QuoteResponseDto> {
    try {
      const quotes = await this.sourcesManager.fetchQuotes(source, batch);
      const requestedQuote = await this.processBatchQuotes(
        source,
        quotes,
        pair,
      );

      if (!requestedQuote) {
        throw new PriceNotFoundException(pair, source);
      }

      return requestedQuote;
    } catch (error) {
      this.logger.debug(
        `Batch fetch failed for ${source}, falling back to error: ${String(
          error,
        )}`,
      );
      throw error;
    }
  }

  private splitIntoBatches(pairs: Pair[], maxBatchSize: number): Pair[][] {
    const batches: Pair[][] = [];
    for (let i = 0; i < pairs.length; i += maxBatchSize) {
      batches.push(pairs.slice(i, i + maxBatchSize));
    }
    return batches;
  }

  async prefetchBatch(source: SourceName, pairs: Pair[]): Promise<void> {
    if (pairs.length === 0) return;

    const maxBatchSize = this.sourcesManager.getMaxBatchSize(source);

    if (pairs.length <= maxBatchSize) {
      try {
        const quotes = await this.sourcesManager.fetchQuotes(source, pairs);
        for (const quote of quotes) {
          await this.cacheAndTrackQuote(source, quote);
        }
      } catch (error) {
        this.logger.debug(
          `Batch prefetch failed for ${source}: ${String(error)}`,
        );
      }
      return;
    }

    const batches = this.splitIntoBatches(pairs, maxBatchSize);
    this.logger.debug(
      `Splitting ${pairs.length} pairs into ${batches.length} batches for ${source} (max: ${maxBatchSize})`,
    );

    const batchPromises = batches.map(async (batch, index) => {
      try {
        const quotes = await this.sourcesManager.fetchQuotes(source, batch);
        for (const quote of quotes) {
          await this.cacheAndTrackQuote(source, quote);
        }
        return quotes.length;
      } catch (error) {
        this.logger.debug(
          `Batch prefetch failed for ${source} (batch ${index + 1}/${batches.length}): ${String(error)}`,
        );
        return 0;
      }
    });

    const results = await Promise.allSettled(batchPromises);
    const successfulQuotes = results
      .filter(
        (result): result is PromiseFulfilledResult<number> =>
          result.status === 'fulfilled',
      )
      .reduce((sum, result) => sum + result.value, 0);

    this.logger.debug(
      `Prefetched ${successfulQuotes} quotes in ${batches.length} parallel batches for ${source}`,
    );
  }
}
