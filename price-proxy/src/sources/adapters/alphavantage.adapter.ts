import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';

import { AppConfigService } from '../../config';
import { PriceNotFoundException, SourceApiException } from '../exceptions';
import { Pair, Quote, SourceAdapter } from '../source-adapter.interface';
import { SourceName } from '../source-name.enum';

const BASE_URL = 'https://www.alphavantage.co/query';

function splitPair(pair: Pair): { base: string; quote: string } {
  const [base, quote] = pair;
  return { base: base.toUpperCase(), quote: quote.toUpperCase() };
}

@Injectable()
export class AlphaVantageAdapter implements SourceAdapter {
  readonly name = SourceName.ALPHAVANTAGE;
  readonly enabled: boolean;
  private readonly apiKey: string;

  constructor(
    private readonly httpService: HttpService,
    configService: AppConfigService,
  ) {
    this.apiKey = configService.get('sources.alphavantage.apiKey') || '';
    this.enabled =
      configService.get('sources.alphavantage.enabled') && !!this.apiKey;
  }

  async fetchQuote(pair: Pair): Promise<Quote> {
    if (!this.apiKey) {
      throw new SourceApiException(
        this.name,
        new Error('API key is not configured'),
      );
    }

    try {
      const { base, quote } = splitPair(pair);
      const { data } = await firstValueFrom(
        this.httpService.get(BASE_URL, {
          params: {
            function: 'CURRENCY_EXCHANGE_RATE',
            from_currency: base,
            to_currency: quote,
            apikey: this.apiKey,
          },
        }),
      );

      if (data?.['Error Message']) {
        throw new SourceApiException(
          this.name,
          new Error(data['Error Message']),
        );
      }

      if (data?.['Note']) {
        throw new SourceApiException(
          this.name,
          new Error('Rate limit exceeded'),
        );
      }

      const exchangeRate = data?.['Realtime Currency Exchange Rate'];
      const price = exchangeRate?.['5. Exchange Rate'];

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
}
