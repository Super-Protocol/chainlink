import { Injectable } from '@nestjs/common';

import { HttpClient, HttpClientBuilder } from '../../common';
import { AppConfigService } from '../../config';
import { HandleSourceError } from '../decorators';
import { PriceNotFoundException, SourceApiException } from '../exceptions';
import { Pair, Quote, SourceAdapter } from '../source-adapter.interface';
import { SourceName } from '../source-name.enum';

const BASE_URL = 'https://finnhub.io';
const API_PATH = '/api/v1/quote';

interface FinnhubResponse {
  c: number;
  d: number | null;
  dp: number | null;
  h: number;
  l: number;
  o: number;
  pc: number;
  t: number;
  error?: string;
}

@Injectable()
export class FinnhubAdapter implements SourceAdapter {
  readonly name = SourceName.FINNHUB;
  private readonly enabled: boolean;
  private readonly ttl: number;
  private readonly httpClient: HttpClient;
  private readonly apiKey: string;

  constructor(
    httpClientBuilder: HttpClientBuilder,
    configService: AppConfigService,
  ) {
    const sourceConfig = configService.get('sources.finnhub');
    this.apiKey = sourceConfig?.apiKey || '';
    this.enabled = sourceConfig?.enabled && !!this.apiKey;
    this.ttl = sourceConfig?.ttl || 10000;

    this.httpClient = httpClientBuilder.build({
      sourceName: this.name,
      timeoutMs: sourceConfig?.timeoutMs,
      rps: sourceConfig?.rps,
      useProxy: sourceConfig?.useProxy,
      maxConcurrent: sourceConfig?.maxConcurrent,
      baseUrl: BASE_URL,
      defaultParams: {
        token: this.apiKey,
      },
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
    const symbol = pair.join('').toUpperCase();
    const { data } = await this.httpClient.get<FinnhubResponse>(API_PATH, {
      params: {
        symbol,
      },
    });

    if (data.error) {
      throw new SourceApiException(this.name, new Error(data.error));
    }

    const price = data.c;

    if (price === undefined || price === null || price === 0) {
      throw new PriceNotFoundException(pair, this.name);
    }

    return {
      pair,
      price: String(price),
      receivedAt: Date.now(),
    };
  }
}
