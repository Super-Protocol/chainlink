import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';

import { AppConfigService } from '../../config';
import {
  PriceNotFoundException,
  FeatureNotImplementedException,
  SourceApiException,
} from '../exceptions';
import {
  Pair,
  Quote,
  SourceAdapter,
  WithBatch,
} from '../source-adapter.interface';
import { SourceName } from '../source-name.enum';

const BASE_URL = 'https://api.exchangerate.host/latest';

function splitPair(pair: Pair): { base: string; quote: string } {
  const [base, quote] = pair;
  return { base: base.toUpperCase(), quote: quote.toUpperCase() };
}

@Injectable()
export class ExchangeRateHostAdapter implements SourceAdapter, WithBatch {
  readonly name = SourceName.EXCHANGERATE_HOST;
  readonly enabled: boolean;

  constructor(
    private readonly httpService: HttpService,
    configService: AppConfigService,
  ) {
    this.enabled = configService.get('sources.exchangeratehost.enabled');
  }

  async fetchQuote(pair: Pair): Promise<Quote> {
    try {
      const { base, quote } = splitPair(pair);
      const { data } = await firstValueFrom(
        this.httpService.get(BASE_URL, {
          params: { base, symbols: quote },
        }),
      );

      if (!data?.success) {
        throw new SourceApiException(
          this.name,
          new Error(data?.error?.info || 'Unknown error'),
        );
      }

      const price = data?.rates?.[quote];
      if (price === undefined || price === null) {
        throw new PriceNotFoundException(pair, this.name);
      }

      return {
        pair,
        price: String(price),
        receivedAt: Date.now(),
      };
    } catch (error) {
      if (
        error instanceof PriceNotFoundException ||
        error instanceof SourceApiException
      ) {
        throw error;
      }
      throw new SourceApiException(this.name, error as Error);
    }
  }

  async fetchQuotes(_pairs: Pair[]): Promise<Quote[]> {
    throw new FeatureNotImplementedException('batch quotes', this.name);
  }
}
