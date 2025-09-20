import { Injectable, Logger } from '@nestjs/common';

import { BatchQuotesService } from './batch-quotes.service';
import { CacheService, CachedQuote } from './cache';
import {
  QuoteResponseDto,
  PairsBySourceResponseDto,
  AllRegistrationsResponseDto,
} from './dto';
import { PairService } from './pair.service';
import { SourceName } from '../sources';
import { PriceNotFoundException } from '../sources/exceptions';
import { Pair, Quote } from '../sources/source-adapter.interface';
import { SourcesManagerService } from '../sources/sources-manager.service';

@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);

  constructor(
    private readonly sourcesManager: SourcesManagerService,
    private readonly pairService: PairService,
    private readonly cacheService: CacheService,
    private readonly batchQuotesService: BatchQuotesService,
  ) {}

  private createCachedQuote(source: SourceName, quote: Quote): CachedQuote {
    return {
      source,
      pair: quote.pair,
      price: quote.price,
      receivedAt: quote.receivedAt,
      cachedAt: new Date(),
    };
  }

  private createQuoteResponse(
    source: SourceName,
    quote: Quote,
  ): QuoteResponseDto {
    return {
      source,
      pair: quote.pair,
      price: quote.price,
      receivedAt: quote.receivedAt,
    };
  }

  private createQuoteResponseFromCached(cached: CachedQuote): QuoteResponseDto {
    return {
      source: cached.source,
      pair: cached.pair,
      price: cached.price,
      receivedAt: cached.receivedAt,
    };
  }

  private async cacheAndTrackQuote(
    source: SourceName,
    quote: Quote,
  ): Promise<void> {
    const cachedQuoteData = this.createCachedQuote(source, quote);
    await this.cacheService.set(source, quote.pair, cachedQuoteData);
    this.pairService.trackSuccessfulFetch(quote.pair, source);
    this.pairService.trackResponse(quote.pair, source);
  }

  private handlePriceNotFound(pair: Pair, source: SourceName): void {
    this.logger.warn(
      `Pair ${pair.join('/')} not found for source ${source}, removing from registrations`,
    );
    this.pairService.removePairSource(pair, source);
  }

  async getQuote(source: SourceName, pair: Pair): Promise<QuoteResponseDto> {
    this.logger.debug(`Getting quote from ${source} for ${pair.join('/')}`);

    this.pairService.trackQuoteRequest(pair, source);

    const cachedQuote = await this.cacheService.get(source, pair);
    if (cachedQuote) {
      this.logger.debug(
        `Returning cached quote for ${source}:${pair.join('/')}`,
      );
      this.pairService.trackResponse(pair, source);
      return this.createQuoteResponseFromCached(cachedQuote);
    }

    if (this.sourcesManager.isFetchQuotesSupported(source)) {
      return this.fetchWithBatch(source, pair);
    } else {
      return this.fetchSingle(source, pair);
    }
  }

  private async fetchWithBatch(
    source: SourceName,
    pair: Pair,
  ): Promise<QuoteResponseDto> {
    const batch = this.batchQuotesService.buildBatch(source, pair);
    try {
      return await this.batchQuotesService.fetchWithBatch(source, pair, batch);
    } catch (error) {
      this.logger.debug(
        `Batch fetch failed for ${source}, falling back to single fetch: ${String(
          error,
        )}`,
      );
      return this.fetchSingle(source, pair);
    }
  }

  private async fetchSingle(
    source: SourceName,
    pair: Pair,
  ): Promise<QuoteResponseDto> {
    try {
      const quote = await this.sourcesManager.fetchQuote(source, pair);
      await this.cacheAndTrackQuote(source, quote);
      return this.createQuoteResponse(source, quote);
    } catch (error) {
      if (error instanceof PriceNotFoundException) {
        this.handlePriceNotFound(pair, source);
      }
      throw error;
    }
  }

  async getPairsBySource(
    source: SourceName,
  ): Promise<PairsBySourceResponseDto> {
    const pairs = this.pairService.getPairsBySource(source);
    const pairsWithCache = await Promise.all(
      pairs.map(async (pair) => {
        const cachedQuote = await this.cacheService.get(source, pair);
        return {
          pair,
          ...(cachedQuote && {
            cachedPrice: cachedQuote.price,
            receivedAt: cachedQuote.receivedAt,
            cachedAt: cachedQuote.cachedAt,
          }),
        };
      }),
    );

    return {
      source,
      pairs: pairsWithCache,
    };
  }

  async getAllRegistrations(): Promise<AllRegistrationsResponseDto> {
    const registrations = this.pairService.getAllRegistrations();
    const registrationsWithCache = await Promise.all(
      registrations.map(async (reg) => {
        const cachedQuote = await this.cacheService.get(reg.source, reg.pair);
        return {
          pair: reg.pair,
          source: reg.source,
          registeredAt: reg.registeredAt,
          lastFetchAt: reg.lastFetchAt,
          lastResponseAt: reg.lastResponseAt,
          lastRequestAt: reg.lastRequestAt,
          ...(cachedQuote && {
            cachedPrice: cachedQuote.price,
            receivedAt: cachedQuote.receivedAt,
            cachedAt: cachedQuote.cachedAt,
          }),
        };
      }),
    );

    return {
      registrations: registrationsWithCache,
    };
  }
}
