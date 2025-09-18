import { URLSearchParams } from 'url';

import { Injectable } from '@nestjs/common';
import { isAxiosError } from 'axios';

import { HttpClient, HttpClientBuilder } from '../../common';
import { AppConfigService } from '../../config';
import {
  PriceNotFoundException,
  SourceApiException,
  UnsupportedPairException,
} from '../exceptions';
import { Pair, Quote, SourceAdapter } from '../source-adapter.interface';
import { SourceName } from '../source-name.enum';

const BASE_URL = 'https://api.coingecko.com';
const API_PATH = '/api/v3/simple/price';

type CoinGeckoResponse = Record<string, Record<string, number>>;

@Injectable()
export class CoinGeckoAdapter implements SourceAdapter {
  readonly name = SourceName.COINGECKO;
  readonly enabled: boolean;
  private readonly httpClient: HttpClient;

  constructor(
    httpClientBuilder: HttpClientBuilder,
    configService: AppConfigService,
  ) {
    const sourceConfig = configService.get('sources.coingecko');
    this.enabled = sourceConfig?.enabled || false;

    this.httpClient = httpClientBuilder.build({
      sourceName: this.name,
      timeoutMs: sourceConfig?.timeoutMs,
      rps: sourceConfig?.rps,
      useProxy: sourceConfig?.useProxy,
      maxConcurrent: sourceConfig?.maxConcurrent,
      baseUrl: BASE_URL,
    });
  }

  async fetchQuote(pair: Pair): Promise<Quote> {
    const [base, quote] = pair;

    const params = new URLSearchParams({
      ids: base,
      vs_currencies: quote,
    });

    try {
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
        receivedAt: Date.now(),
      };
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 400) {
        throw new UnsupportedPairException(pair, this.name);
      }
      throw new SourceApiException(this.name, error as Error);
    }
  }
}
