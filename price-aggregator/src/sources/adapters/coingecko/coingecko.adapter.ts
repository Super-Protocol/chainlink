import { URLSearchParams } from 'url';

import { Injectable } from '@nestjs/common';
import { isAxiosError } from 'axios';

import { getCoinIdMap } from './coingecko.utils';
import { HttpClient, HttpClientBuilder } from '../../../common';
import { AppConfigService } from '../../../config';
import { HandleSourceError } from '../../decorators';
import {
  BatchSizeExceededException,
  PriceNotFoundException,
  SourceApiException,
} from '../../exceptions';
import { Pair, Quote, SourceAdapter } from '../../source-adapter.interface';
import { SourceName } from '../../source-name.enum';

const PRO_BASE_URL = 'https://pro-api.coingecko.com';
const FREE_BASE_URL = 'https://api.coingecko.com';
const API_PATH = '/api/v3/simple/price';

type CoinGeckoResponse = Record<string, Record<string, number>>;

@Injectable()
export class CoinGeckoAdapter implements SourceAdapter {
  readonly name = SourceName.COINGECKO;
  private readonly enabled: boolean;
  private readonly ttl: number;
  private readonly refetch: boolean;
  private readonly maxBatchSize: number;
  private readonly httpClient: HttpClient;
  private readonly apiKey?: string;
  private readonly coinIdMap: Promise<Map<string, string>>;

  constructor(
    httpClientBuilder: HttpClientBuilder,
    configService: AppConfigService,
  ) {
    const sourceConfig = configService.get('sources.coingecko');
    const { enabled, ttl, refetch, maxBatchSize, apiKey } = sourceConfig;

    this.enabled = enabled;
    this.ttl = ttl;
    this.refetch = refetch;
    this.maxBatchSize = maxBatchSize;
    this.apiKey = apiKey;

    this.httpClient = httpClientBuilder.build({
      sourceName: this.name,
      ...sourceConfig,
      baseUrl: this.apiKey ? PRO_BASE_URL : FREE_BASE_URL,
    });

    this.coinIdMap = getCoinIdMap();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getTtl(): number {
    return this.ttl;
  }

  isRefetchEnabled(): boolean {
    return this.refetch;
  }

  getMaxBatchSize(): number {
    return this.maxBatchSize;
  }

  @HandleSourceError()
  async fetchQuote(pair: Pair): Promise<Quote> {
    const [base, quote] = pair;
    const coinIdMap = await this.coinIdMap;
    const coinId = coinIdMap.get(base.toLowerCase()) || base;

    const params = new URLSearchParams({
      ids: coinId,
      vs_currencies: quote,
    });

    if (this.apiKey) {
      params.append('x_cg_pro_api_key', this.apiKey);
    }

    const { data } = await this.httpClient.get<CoinGeckoResponse>(
      `${API_PATH}?${params.toString()}`,
    );

    const price = data?.[coinId]?.[quote];

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

    if (pairs.length > this.maxBatchSize) {
      throw new BatchSizeExceededException(
        pairs.length,
        this.maxBatchSize,
        this.name,
      );
    }

    const coinIdMap = await this.coinIdMap;
    const coinIds = [
      ...new Set(
        pairs.map(([base]) => coinIdMap.get(base.toLowerCase()) || base),
      ),
    ];
    const currencies = [...new Set(pairs.map((pair) => pair[1]))];

    const params = new URLSearchParams({
      ids: coinIds.join(','),
      vs_currencies: currencies.join(','),
    });

    if (this.apiKey) {
      params.append('x_cg_pro_api_key', this.apiKey);
    }

    try {
      const { data } = await this.httpClient.get<CoinGeckoResponse>(
        `${API_PATH}?${params.toString()}`,
      );

      const quotes: Quote[] = [];
      const now = new Date();

      for (const pair of pairs) {
        const [base, quote] = pair;
        const coinId = coinIdMap.get(base.toLowerCase()) || base;
        const price = data?.[coinId]?.[quote];

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
