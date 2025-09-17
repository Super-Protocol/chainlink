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

const BASE_URL = 'https://api.coinbase.com/v2/prices';

@Injectable()
export class CoinbaseAdapter
  implements SourceAdapter, WithBatch, WithWebSocket
{
  readonly name = SourceName.COINBASE;
  readonly enabled: boolean;

  constructor(
    private readonly httpService: HttpService,
    configService: AppConfigService,
  ) {
    this.enabled = configService.get('sources.coinbase.enabled');
  }

  async fetchQuote(pair: Pair): Promise<Quote> {
    try {
      const coinbasePair = pair.join('-');
      const { data } = await firstValueFrom(
        this.httpService.get(`${BASE_URL}/${coinbasePair}/spot`),
      );

      const price = data?.data?.amount;
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
