import { Injectable, Logger } from '@nestjs/common';

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
  ) {}

  async getQuote(source: SourceName, pair: Pair): Promise<QuoteResponseDto> {
    this.logger.debug(`Getting quote from ${source} for ${pair.join('/')}`);

    this.pairService.trackQuoteRequest(pair, source);

    try {
      const quote = await this.sourcesManager.fetchQuote(source, pair);

      this.pairService.trackSuccessfulQuote(pair, source);

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
        lastQuoteAt: reg.lastQuoteAt,
        lastRequestAt: reg.lastRequestAt,
      })),
    };
  }
}
