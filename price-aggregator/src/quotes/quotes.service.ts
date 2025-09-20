import { Injectable, Logger } from '@nestjs/common';

import { CacheService, CachedQuote } from './cache';
import {
  QuoteResponseDto,
  PairsBySourceResponseDto,
  AllRegistrationsResponseDto,
} from './dto';
import { PairService } from './pair.service';
import { SourceName } from '../sources';
import { PriceNotFoundException } from '../sources/exceptions';
import { Pair } from '../sources/source-adapter.interface';
import { SourcesManagerService } from '../sources/sources-manager.service';

@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);

  constructor(
    private readonly sourcesManager: SourcesManagerService,
    private readonly pairService: PairService,
    private readonly cacheService: CacheService,
  ) {}

  async getQuote(source: SourceName, pair: Pair): Promise<QuoteResponseDto> {
    this.logger.debug(`Getting quote from ${source} for ${pair.join('/')}`);

    this.pairService.trackQuoteRequest(pair, source);

    const cachedQuote = await this.cacheService.get(source, pair);
    if (cachedQuote) {
      this.logger.debug(
        `Returning cached quote for ${source}:${pair.join('/')}`,
      );

      this.pairService.trackResponse(pair, source);

      return {
        source: cachedQuote.source,
        pair: cachedQuote.pair,
        price: cachedQuote.price,
        receivedAt: cachedQuote.receivedAt,
      };
    }

    try {
      const quote = await this.sourcesManager.fetchQuote(source, pair);

      this.pairService.trackSuccessfulFetch(pair, source);
      this.pairService.trackResponse(pair, source);

      const cachedQuoteData: CachedQuote = {
        source,
        pair: quote.pair,
        price: quote.price,
        receivedAt: quote.receivedAt,
        cachedAt: new Date(),
      };

      await this.cacheService.set(source, pair, cachedQuoteData);

      return {
        source,
        pair: quote.pair,
        price: quote.price,
        receivedAt: quote.receivedAt,
      };
    } catch (error) {
      if (error instanceof PriceNotFoundException) {
        this.logger.warn(
          `Pair ${pair.join('/')} not found for source ${source}, removing from registrations`,
        );
        this.pairService.removePairSource(pair, source);
      }

      throw error;
    }
  }

  getPairsBySource(source: SourceName): PairsBySourceResponseDto {
    const pairs = this.pairService.getPairsBySource(source);
    return {
      source,
      pairs,
    };
  }

  getAllRegistrations(): AllRegistrationsResponseDto {
    const registrations = this.pairService.getAllRegistrations();
    return {
      registrations: registrations.map((reg) => ({
        pair: reg.pair,
        source: reg.source,
        registeredAt: reg.registeredAt,
        lastFetchAt: reg.lastFetchAt,
        lastResponseAt: reg.lastResponseAt,
        lastRequestAt: reg.lastRequestAt,
      })),
    };
  }
}
