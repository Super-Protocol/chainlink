import { Injectable } from '@nestjs/common';

import { HttpClient, HttpClientBuilder } from '../../../common';
import { AppConfigService } from '../../../config';
import { HandleSourceError } from '../../decorators';
import { PriceNotFoundException } from '../../exceptions';
import { Pair, Quote, SourceAdapter } from '../../source-adapter.interface';
import { SourceName } from '../../source-name.enum';

const BASE_URL = 'https://api.frankfurter.app';
const API_PATH = '/latest';

interface FrankfurterResponse {
  amount: number;
  base: string;
  date: string;
  rates: Record<string, number>;
}

@Injectable()
export class FrankfurterAdapter implements SourceAdapter {
  readonly name = SourceName.FRANKFURTER;
  private readonly enabled: boolean;
  private readonly ttl: number;
  private readonly refetch: boolean;
  private readonly httpClient: HttpClient;

  constructor(
    httpClientBuilder: HttpClientBuilder,
    configService: AppConfigService,
  ) {
    const sourceConfig = configService.get('sources.frankfurter');
    const { enabled, ttl, refetch } = sourceConfig;
    this.enabled = enabled;
    this.ttl = ttl;
    this.refetch = refetch;

    this.httpClient = httpClientBuilder.build({
      sourceName: this.name,
      ...sourceConfig,
      baseUrl: BASE_URL,
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
    const [base, quote] = pair;
    const { data } = await this.httpClient.get<FrankfurterResponse>(API_PATH, {
      params: {
        from: base.toUpperCase(),
        to: quote.toUpperCase(),
      },
    });
    const price = data?.rates?.[quote.toUpperCase()];

    if (price === undefined || price === null) {
      throw new PriceNotFoundException(pair, this.name);
    }

    return {
      pair,
      price: String(price),
      receivedAt: new Date(),
    };
  }
}
