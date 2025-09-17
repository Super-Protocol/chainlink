import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';

import { AppConfigService } from '../../config';
import {
  PriceNotFoundException,
  FeatureNotImplementedException,
  SourceApiException,
  UnsupportedPairException,
} from '../exceptions';
import {
  Pair,
  Quote,
  SourceAdapter,
  WithBatch,
  WithWebSocket,
} from '../source-adapter.interface';
import { SourceName } from '../source-name.enum';

const BASE_URL = 'https://api.binance.com/api/v3/ticker/price';

@Injectable()
export class BinanceAdapter implements SourceAdapter, WithBatch, WithWebSocket {
  readonly name = SourceName.BINANCE;
  readonly enabled: boolean;

  constructor(
    private readonly httpService: HttpService,
    configService: AppConfigService,
  ) {
    this.enabled = configService.get('sources.binance.enabled');
  }

  async fetchQuote(pair: Pair): Promise<Quote> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get(BASE_URL, { params: { symbol: pair.join('') } }),
      );
      const price = data?.price;
      if (price === undefined || price === null) {
        throw new PriceNotFoundException(pair, this.name);
      }
      const now = Date.now();

      return {
        pair,
        price: String(price),
        receivedAt: now,
      };
    } catch (error) {
      if (error instanceof PriceNotFoundException) {
        throw error;
      }

      if (
        error?.response?.status === 400 &&
        error?.response?.data?.msg === 'Invalid symbol.'
      ) {
        throw new UnsupportedPairException(pair, this.name);
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
