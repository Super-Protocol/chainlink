import { Injectable } from '@nestjs/common';

import { FinnhubStreamService } from './finnhub-stream.service';
import { getSymbolAndEndpoint } from './finnhub.utils';
import { HttpClient, HttpClientBuilder } from '../../../common';
import { AppConfigService } from '../../../config';
import { HandleSourceError } from '../../decorators';
import { PriceNotFoundException, SourceApiException } from '../../exceptions';
import { QuoteStreamService } from '../../quote-stream.interface';
import { Pair, Quote, SourceAdapter } from '../../source-adapter.interface';
import { SourceName } from '../../source-name.enum';

const BASE_URL = 'https://finnhub.io';

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
  private readonly refetch: boolean;
  private readonly httpClient: HttpClient;
  private readonly apiKey: string;

  constructor(
    httpClientBuilder: HttpClientBuilder,
    configService: AppConfigService,
    private readonly finnhubStreamService: FinnhubStreamService,
  ) {
    const sourceConfig = configService.get('sources.finnhub');
    const { apiKey, enabled, ttl, refetch } = sourceConfig;
    this.apiKey = apiKey;
    this.enabled = enabled;
    this.ttl = ttl;
    this.refetch = refetch;

    this.httpClient = httpClientBuilder.build({
      sourceName: this.name,
      ...sourceConfig,
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

  isRefetchEnabled(): boolean {
    return this.refetch;
  }

  @HandleSourceError()
  async fetchQuote(pair: Pair): Promise<Quote> {
    const { symbol, endpoint } = getSymbolAndEndpoint(pair);
    const { data } = await this.httpClient.get<FinnhubResponse>(endpoint, {
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
      receivedAt: new Date(),
    };
  }

  getStreamService(): QuoteStreamService {
    return this.finnhubStreamService;
  }

  async closeAllStreams(): Promise<void> {
    await this.finnhubStreamService.disconnect();
  }
}
