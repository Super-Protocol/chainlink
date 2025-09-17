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

const BASE_URL = 'https://api.kraken.com/0/public/Ticker';

// TODO: make normal mapping
const KRAKEN_PAIR_MAP: Record<string, string> = {
  'BTC-USD': 'XXBTZUSD',
  'ETH-USD': 'XETHZUSD',
  'BTC-EUR': 'XXBTZEUR',
  'ETH-EUR': 'XETHZEUR',
  // Add more mappings as needed
};

@Injectable()
export class KrakenAdapter implements SourceAdapter, WithBatch, WithWebSocket {
  readonly name = SourceName.KRAKEN;
  readonly enabled: boolean;

  constructor(
    private readonly httpService: HttpService,
    configService: AppConfigService,
  ) {
    this.enabled = configService.get('sources.kraken.enabled');
  }

  private mapPairToKraken(pair: Pair): string {
    const krakenPair = KRAKEN_PAIR_MAP[pair.join('-').toUpperCase()];
    if (!krakenPair) {
      throw new PriceNotFoundException(pair, this.name);
    }
    return krakenPair;
  }

  async fetchQuote(pair: Pair): Promise<Quote> {
    try {
      const krakenPair = this.mapPairToKraken(pair);
      const { data } = await firstValueFrom(
        this.httpService.get(BASE_URL, { params: { pair: krakenPair } }),
      );

      if (data?.error?.length > 0) {
        throw new SourceApiException(
          this.name,
          new Error(data.error.join(', ')),
        );
      }

      const tickerData = data?.result?.[krakenPair];
      const price = tickerData?.c?.[0]; // c[0] is the current price

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
    throw new FeatureNotImplementedException('this feature', this.name);
  }

  streamQuotes(_pairs: Pair[]): AsyncIterable<Quote> {
    throw new FeatureNotImplementedException('this feature', this.name);
  }
}
