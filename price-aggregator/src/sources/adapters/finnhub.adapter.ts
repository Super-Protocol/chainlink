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
  WithWebSocket,
} from '../source-adapter.interface';
import { SourceName } from '../source-name.enum';

const BASE_URL = 'https://finnhub.io/api/v1/quote';

// TODO: make normal mapping
const FINNHUB_FOREX_MAP: Record<string, string> = {
  'EUR-USD': 'OANDA:EUR_USD',
  'GBP-USD': 'OANDA:GBP_USD',
  'USD-JPY': 'OANDA:USD_JPY',
  'USD-CHF': 'OANDA:USD_CHF',
  'AUD-USD': 'OANDA:AUD_USD',
  'USD-CAD': 'OANDA:USD_CAD',
  'NZD-USD': 'OANDA:NZD_USD',
};

// TODO: make normal mapping
const FINNHUB_CRYPTO_MAP: Record<string, string> = {
  'BTC-USD': 'BINANCE:BTCUSDT',
  'ETH-USD': 'BINANCE:ETHUSDT',
  'BTC-EUR': 'BINANCE:BTCEUR',
  'ETH-EUR': 'BINANCE:ETHEUR',
};

@Injectable()
export class FinnhubAdapter implements SourceAdapter, WithWebSocket {
  readonly name = SourceName.FINNHUB;
  readonly enabled: boolean;
  private readonly apiKey: string;

  constructor(
    private readonly httpService: HttpService,
    configService: AppConfigService,
  ) {
    this.apiKey = configService.get('sources.finnhub.apiKey') || '';
    this.enabled =
      configService.get('sources.finnhub.enabled') && !!this.apiKey;
  }

  private mapPairToFinnhub(pair: Pair): string {
    const upperPair = pair.join('-').toUpperCase();

    // Try forex first
    if (FINNHUB_FOREX_MAP[upperPair]) {
      return FINNHUB_FOREX_MAP[upperPair];
    }

    // Try crypto
    if (FINNHUB_CRYPTO_MAP[upperPair]) {
      return FINNHUB_CRYPTO_MAP[upperPair];
    }

    throw new PriceNotFoundException(pair, this.name);
  }

  async fetchQuote(pair: Pair): Promise<Quote> {
    try {
      if (!this.apiKey) {
        throw new SourceApiException(
          this.name,
          new Error('API key is not configured'),
        );
      }

      const symbol = this.mapPairToFinnhub(pair);
      const { data } = await firstValueFrom(
        this.httpService.get(BASE_URL, {
          params: { symbol, token: this.apiKey },
        }),
      );

      if (data?.error) {
        throw new SourceApiException(this.name, new Error(data.error));
      }

      const price = data?.c; // current price
      if (price === undefined || price === null || price === 0) {
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

  streamQuotes(_pairs: Pair[]): AsyncIterable<Quote> {
    throw new FeatureNotImplementedException('this feature', this.name);
  }
}
