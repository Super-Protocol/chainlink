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

const BASE_URL = 'https://api.coinbase.com';
const API_PATH = '/v2/prices';

interface CoinbaseResponse {
  data: {
    base: string;
    currency: string;
    amount: string;
  };
}

@Injectable()
export class CoinbaseAdapter implements SourceAdapter {
  readonly name = SourceName.COINBASE;
  readonly enabled: boolean;
  private readonly httpClient: HttpClient;

  constructor(
    httpClientBuilder: HttpClientBuilder,
    configService: AppConfigService,
  ) {
    const sourceConfig = configService.get('sources.coinbase');
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
    try {
      const { data } = await this.httpClient.get<CoinbaseResponse>(
        `${API_PATH}/${pair[0]}-${pair[1]}/spot`,
      );
      const price = data?.data?.amount;

      if (price === undefined || price === null) {
        throw new PriceNotFoundException(pair, this.name);
      }

      return {
        pair,
        price,
        receivedAt: Date.now(),
      };
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 404) {
        throw new UnsupportedPairException(pair, this.name);
      }
      throw new SourceApiException(this.name, error as Error);
    }
  }
}
