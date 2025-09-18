import { Injectable } from '@nestjs/common';
import { isAxiosError } from 'axios';

import { HttpClient, HttpClientBuilder } from '../../common';
import { AppConfigService } from '../../config';
import {
  FeatureNotImplementedException,
  PriceNotFoundException,
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

const BASE_URL = 'https://api.binance.com';
const API_PATH = '/api/v3/ticker/price';

@Injectable()
export class BinanceAdapter implements SourceAdapter, WithBatch, WithWebSocket {
  readonly name = SourceName.BINANCE;
  readonly enabled: boolean;
  private readonly httpClient: HttpClient;

  constructor(
    httpClientBuilder: HttpClientBuilder,
    configService: AppConfigService,
  ) {
    const sourceConfig = configService.get('sources.binance');
    this.enabled = sourceConfig?.enabled || false;

    this.httpClient = httpClientBuilder.build({
      sourceName: 'binance',
      timeoutMs: sourceConfig?.timeoutMs || 10000,
      rps: sourceConfig?.rps,
      useProxy: sourceConfig?.useProxy || false,
      maxConcurrent: sourceConfig?.maxConcurrent,
      baseUrl: BASE_URL,
    });
  }

  async fetchQuote(pair: Pair): Promise<Quote> {
    try {
      const { data } = await this.httpClient.get<{ price: string }>(API_PATH, {
        params: { symbol: pair.join('') },
      });
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

      if (isAxiosError(error)) {
        if (
          error.response?.status === 400 &&
          error.response?.data?.msg === 'Invalid symbol.'
        ) {
          throw new UnsupportedPairException(pair, this.name);
        }
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
