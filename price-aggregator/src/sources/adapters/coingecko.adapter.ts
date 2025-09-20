import { URLSearchParams } from 'url';

import { Injectable } from '@nestjs/common';
import { isAxiosError } from 'axios';

import { HttpClient, HttpClientBuilder } from '../../common';
import { AppConfigService } from '../../config';
import { HandleSourceError } from '../decorators';
import {
  BatchSizeExceededException,
  PriceNotFoundException,
  SourceApiException,
} from '../exceptions';
import {
  Pair,
  Quote,
  SourceAdapter,
  WithBatch,
} from '../source-adapter.interface';
import { SourceName } from '../source-name.enum';

const BASE_URL = 'https://api.coingecko.com';
const API_PATH = '/api/v3/simple/price';
const MAX_BATCH_SIZE = 100;

type CoinGeckoResponse = Record<string, Record<string, number>>;

@Injectable()
export class CoinGeckoAdapter implements SourceAdapter, WithBatch {
  readonly name = SourceName.COINGECKO;
  private readonly enabled: boolean;
  private readonly ttl: number;
  private readonly httpClient: HttpClient;

  constructor(
    httpClientBuilder: HttpClientBuilder,
    configService: AppConfigService,
  ) {
    const sourceConfig = configService.get('sources.coingecko');
    this.enabled = sourceConfig?.enabled || false;
    this.ttl = sourceConfig?.ttl || 10000;

    this.httpClient = httpClientBuilder.build({
      sourceName: this.name,
      timeoutMs: sourceConfig?.timeoutMs,
      rps: sourceConfig?.rps,
      useProxy: sourceConfig?.useProxy,
      maxConcurrent: sourceConfig?.maxConcurrent,
      baseUrl: BASE_URL,
    });
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getTtl(): number {
    return this.ttl;
  }

  @HandleSourceError()
  async fetchQuote(pair: Pair): Promise<Quote> {
    const [base, quote] = pair;

    const params = new URLSearchParams({
      ids: base,
      vs_currencies: quote,
    });

    const { data } = await this.httpClient.get<CoinGeckoResponse>(
      `${API_PATH}?${params.toString()}`,
    );

    const price = data?.[base]?.[quote];

    if (price === undefined || price === null) {
      throw new PriceNotFoundException(pair, this.name);
    }

    return {
      pair,
      price: String(price),
      receivedAt: new Date(),
    };
  }

  @HandleSourceError()
  async fetchQuotes(pairs: Pair[]): Promise<Quote[]> {
    if (!pairs || pairs.length === 0) {
      return [];
    }

    if (pairs.length > MAX_BATCH_SIZE) {
      throw new BatchSizeExceededException(
        pairs.length,
        MAX_BATCH_SIZE,
        this.name,
      );
    }

    const coinIds = [...new Set(pairs.map((pair) => pair[0]))];
    const currencies = [...new Set(pairs.map((pair) => pair[1]))];

    const params = new URLSearchParams({
      ids: coinIds.join(','),
      vs_currencies: currencies.join(','),
    });

    try {
      const { data } = await this.httpClient.get<CoinGeckoResponse>(
        `${API_PATH}?${params.toString()}`,
      );

      const quotes: Quote[] = [];
      const now = new Date();

      for (const pair of pairs) {
        const [base, quote] = pair;
        const price = data?.[base]?.[quote];

        if (price !== undefined && price !== null) {
          quotes.push({
            pair,
            price: String(price),
            receivedAt: now,
          });
        }
      }

      return quotes;
    } catch (error) {
      if (error instanceof BatchSizeExceededException) {
        throw error;
      }

      if (isAxiosError(error) && error.response) {
        const status = error.response.status;

        if (status === 400 || status === 404) {
          return [];
        }

        if (status >= 500) {
          throw new SourceApiException(this.name, error);
        }
      }

      throw new SourceApiException(this.name, error as Error);
    }
  }
}
