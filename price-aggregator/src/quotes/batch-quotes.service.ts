import { Injectable, Logger } from '@nestjs/common';

import { CacheService, CachedQuote } from './cache';
import { QuoteResponseDto } from './dto';
import { PairService } from './pair.service';
import { SourceName } from '../sources';
import { PriceNotFoundException } from '../sources/exceptions';
import { Pair, Quote } from '../sources/source-adapter.interface';
import { SourcesManagerService } from '../sources/sources-manager.service';

@Injectable()
export class BatchQuotesService {
  private readonly logger = new Logger(BatchQuotesService.name);
  private static readonly MAX_BATCH_SIZE = 100;

  constructor(
    private readonly sourcesManager: SourcesManagerService,
    private readonly pairService: PairService,
    private readonly cacheService: CacheService,
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
    await this.cacheService.set(
      source,
      quote.pair,
      this.createCachedQuote(source, quote),
    );
    this.pairService.trackSuccessfulFetch(quote.pair, source);
    this.pairService.trackResponse(quote.pair, source);
  }

  private async processBatchQuotes(
    source: SourceName,
    quotes: Quote[],
    requestedPair: Pair,
  ): Promise<QuoteResponseDto | null> {
    const requestedPairKey = requestedPair.join('/');

    for (const quote of quotes) {
      await this.cacheAndTrackQuote(source, quote);
    }

    const requestedQuote = quotes.find(
      (q) => q.pair.join('/') === requestedPairKey,
    );
    return requestedQuote
      ? this.createQuoteResponse(source, requestedQuote)
      : null;
  }

  buildBatch(source: SourceName, pair: Pair): Pair[] {
    const requestedPairKey = pair.join('/');
    const batch = [pair];

    const registrations =
      this.pairService.getPairsBySourceWithTimestamps(source);

    const sortedByOldest = registrations.sort(
      (a, b) => a.lastFetchAt.getTime() - b.lastFetchAt.getTime(),
    );

    for (const registration of sortedByOldest) {
      if (registration.pair.join('/') === requestedPairKey) continue;
      batch.push(registration.pair);
      if (batch.length >= BatchQuotesService.MAX_BATCH_SIZE) break;
    }

    this.logger.debug(
      `Built batch of ${batch.length} for ${source}, requested ${requestedPairKey}`,
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

  async prefetchBatch(source: SourceName, pairs: Pair[]): Promise<void> {
    if (pairs.length === 0) return;

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
  }
}
