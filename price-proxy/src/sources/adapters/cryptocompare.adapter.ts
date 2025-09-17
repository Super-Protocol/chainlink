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
  WithWebSocket,
} from '../source-adapter.interface';
import { SourceName } from '../source-name.enum';

const BASE_URL = 'https://min-api.cryptocompare.com/data/price';

function splitPair(pair: Pair): { base: string; quote: string } {
  const [base, quote] = pair;
  return { base, quote };
}

@Injectable()
export class CryptoCompareAdapter
  implements SourceAdapter, WithBatch, WithWebSocket
{
  readonly name = SourceName.CRYPTOCOMPARE;
  readonly enabled: boolean;
  private readonly apiKey?: string;

  constructor(
    private readonly httpService: HttpService,
    configService: AppConfigService,
  ) {
    this.apiKey = configService.get('sources.cryptocompare.apiKey');
    this.enabled = configService.get('sources.cryptocompare.enabled');
  }

  async fetchQuote(pair: Pair): Promise<Quote> {
    try {
      const { base, quote } = splitPair(pair);
      const headers: Record<string, string> = {};

      if (this.apiKey) {
        headers.authorization = `Apikey ${this.apiKey}`;
      }

      const { data } = await firstValueFrom(
        this.httpService.get(BASE_URL, {
          params: { fsym: base.toUpperCase(), tsyms: quote.toUpperCase() },
          headers,
        }),
      );

      const price = data?.[quote.toUpperCase()];
      if (price === undefined || price === null) {
        throw new PriceNotFoundException(pair, this.name);
      }

      return {
        pair,
        price: String(price),
        receivedAt: Date.now(),
      };
    } catch (error) {
      if (error instanceof PriceNotFoundException) {
        throw error;
      }
      throw new SourceApiException(this.name, error as Error);
    }
  }

  async fetchQuotes(_pairs: Pair[]): Promise<Quote[]> {
    throw new FeatureNotImplementedException('batch quotes', this.name);
  }

  streamQuotes(_pairs: Pair[]): AsyncIterable<Quote> {
    throw new FeatureNotImplementedException('streaming quotes', this.name);
  }
}
