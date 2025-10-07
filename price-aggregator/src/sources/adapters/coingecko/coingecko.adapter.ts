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
  SourceUnauthorizedException,
} from '../../exceptions';
import {
  Pair,
  Quote,
  SourceAdapter,
  SourceAdapterConfig,
} from '../../source-adapter.interface';
import { SourceName } from '../../source-name.enum';

const PRO_BASE_URL = 'https://pro-api.coingecko.com';
const FREE_BASE_URL = 'https://api.coingecko.com';
const API_PATH = '/api/v3/simple/price';

type CoinGeckoResponse = Record<string, Record<string, number>>;

@Injectable()
export class CoinGeckoAdapter implements SourceAdapter {
  readonly name = SourceName.COINGECKO;
  private readonly sourceConfig: SourceAdapterConfig;
  private readonly httpClient: HttpClient;
  private readonly coinIdMap: Promise<Map<string, string>>;

  constructor(
    httpClientBuilder: HttpClientBuilder,
    configService: AppConfigService,
  ) {
    this.sourceConfig = configService.get('sources.coingecko');

    this.httpClient = httpClientBuilder.build({
      sourceName: this.name,
      ...this.sourceConfig,
      baseUrl: this.sourceConfig.apiKey ? PRO_BASE_URL : FREE_BASE_URL,
    });

    this.coinIdMap = getCoinIdMap(this.httpClient);
  }

  getConfig(): SourceAdapterConfig {
    return this.sourceConfig;
  }

  @HandleSourceError()
  async fetchQuote(pair: Pair): Promise<Quote> {
    const [base, quote] = pair;
    const coinIdMap = await this.coinIdMap;
    const coinId = coinIdMap.get(base.toLowerCase()) || base;

    const coinIdLc = coinId.toLowerCase();
    const quoteLc = quote.toLowerCase();
    const params = new URLSearchParams({
      ids: coinIdLc,
      vs_currencies: quoteLc,
    });

    if (this.sourceConfig.apiKey) {
      params.append('x_cg_pro_api_key', this.sourceConfig.apiKey);
    }

    const { data } = await this.httpClient.get<CoinGeckoResponse>(
      `${API_PATH}?${params.toString()}`,
    );

    const price = data?.[coinIdLc]?.[quoteLc];

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

    if (pairs.length > this.sourceConfig.maxBatchSize!) {
      throw new BatchSizeExceededException(
        pairs.length,
        this.sourceConfig.maxBatchSize!,
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
      vs_currencies: currencies.map((c) => c.toLowerCase()).join(','),
    });

    if (this.sourceConfig.apiKey) {
      params.append('x_cg_pro_api_key', this.sourceConfig.apiKey);
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
        const price = data?.[coinId]?.[quote.toLowerCase()];

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

        if (status === 401) {
          throw new SourceUnauthorizedException(this.name);
        }

        if (status >= 500) {
          throw new SourceApiException(this.name, error);
        }
      }

      throw new SourceApiException(this.name, error as Error);
    }
  }
}
