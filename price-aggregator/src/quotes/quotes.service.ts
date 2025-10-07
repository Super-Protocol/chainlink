import { Injectable, Logger } from '@nestjs/common';

import { BatchQuotesService } from './batch-quotes.service';
import { CacheService, CachedQuote } from './cache';
import {
  QuoteResponseDto,
  PairsBySourceResponseDto,
  AllRegistrationsResponseDto,
} from './dto';
import { PairService } from './pair.service';
import { SingleFlight } from '../common';
import { MetricsService } from '../metrics/metrics.service';
import { SourceName } from '../sources';
import {
  PriceNotFoundException,
  SourceUnauthorizedException,
} from '../sources/exceptions';
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
    private readonly metricsService: MetricsService,
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
    await this.cacheService.set(cachedQuoteData);
    this.pairService.trackSuccessfulFetch(quote.pair, source);
    this.pairService.trackResponse(quote.pair, source);
    this.metricsService.updateSourceLastUpdate(source, quote.pair);
  }

  private handlePriceNotFound(pair: Pair, source: SourceName): void {
    this.logger.warn(
      `Pair ${pair.join('/')} not found for source ${source}, removing from registrations`,
    );
    this.pairService.removePairSource(pair, source);
  }

  @SingleFlight((source, pair) => `${source}-${pair.join('-')}`)
  async getQuote(source: SourceName, pair: Pair): Promise<QuoteResponseDto> {
    this.logger.debug(`Getting quote from ${source} for ${pair.join('/')}`);

    this.pairService.trackQuoteRequest(pair, source);

    const cachedQuote = await this.cacheService.get(source, pair);
    if (cachedQuote) {
      this.logger.debug(
        `Returning cached quote for ${source}:${pair.join('/')}`,
      );
      this.pairService.trackResponse(pair, source);
      this.metricsService.cacheHits.inc({ source });
      this.metricsService.updateQuoteDataAge(
        source,
        pair,
        cachedQuote.receivedAt,
      );
      return this.createQuoteResponseFromCached(cachedQuote);
    }

    this.metricsService.cacheMisses.inc({ source });
    this.metricsService.cacheMissByPair.inc({
      source,
      pair: pair.join('/'),
    });

    if (this.sourcesManager.isFetchQuotesSupported(source)) {
      const quote = await this.fetchWithBatch(source, pair);
      this.metricsService.updateQuoteDataAge(source, pair, quote.receivedAt);
      return quote;
    } else {
      const quote = await this.fetchSingle(source, pair);
      this.metricsService.updateQuoteDataAge(source, pair, quote.receivedAt);
      return quote;
    }
  }

  private async fetchWithBatch(
    source: SourceName,
    pair: Pair,
  ): Promise<QuoteResponseDto> {
    const batch = this.batchQuotesService.buildBatch(source, pair);

    if (batch.length === 1) {
      return this.fetchSingle(source, pair);
    }

    try {
      const result = await this.batchQuotesService.fetchWithBatch(
        source,
        pair,
        batch,
      );
      return result;
    } catch (error) {
      this.logger.debug(
        `Batch fetch failed for ${source}, falling back to single fetch: ${String(
          error,
        )}`,
      );
      this.metricsService.errorCount.inc({ type: 'batch_error', source });
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
      this.metricsService.errorCount.inc({ type: 'fetch_error', source });
      if (error instanceof PriceNotFoundException) {
        this.metricsService.priceNotFoundCount.inc({
          source,
          pair: pair.join('/'),
        });
        this.handlePriceNotFound(pair, source);
      } else if (error instanceof SourceUnauthorizedException) {
        this.logger.warn(
          `Source ${source} is unauthorized, removing pair ${pair.join('/')}`,
        );
        this.pairService.removePairSource(pair, source);
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
      pairs: registrationsWithCache,
    };
  }
}
