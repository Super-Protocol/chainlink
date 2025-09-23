import { Injectable } from '@nestjs/common';

import { HttpClient, HttpClientBuilder } from '../../../common';
import { AppConfigService } from '../../../config';
import { HandleSourceError } from '../../decorators';
import {
  PriceNotFoundException,
  SourceApiException,
  SourceUnauthorizedException,
} from '../../exceptions';
import { Pair, Quote, SourceAdapter } from '../../source-adapter.interface';
import { SourceName } from '../../source-name.enum';

const BASE_URL = 'https://api.exchangerate.host';
const API_PATH = '/live';

interface ExchangeRateHostResponse {
  success: true;
  terms: string;
  privacy: string;
  timestamp: number;
  source: string;
  quotes: Record<string, number>;
}

interface ExchangeRateHostErrorResponse {
  success: false;
  error: {
    code: number;
    type: string;
    info: string;
  };
}
@Injectable()
export class ExchangeRateHostAdapter implements SourceAdapter {
  readonly name = SourceName.EXCHANGERATE_HOST;
  private readonly enabled: boolean;
  private readonly ttl: number;
  private readonly refetch: boolean;
  private readonly httpClient: HttpClient;
  private readonly apiKey?: string;

  constructor(
    httpClientBuilder: HttpClientBuilder,
    configService: AppConfigService,
  ) {
    const sourceConfig = configService.get('sources.exchangeratehost');
    const { enabled, ttl, refetch, apiKey } = sourceConfig;
    this.enabled = enabled;
    this.ttl = ttl;
    this.refetch = refetch;
    this.apiKey = apiKey;

    this.httpClient = httpClientBuilder.build({
      sourceName: this.name,
      ...sourceConfig,
      baseUrl: BASE_URL,
      defaultParams: this.apiKey ? { access_key: this.apiKey } : {},
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

  private mapErrorCodeToHttpStatus(errorCode: number): number {
    switch (errorCode) {
      case 404:
        return 404;
      case 101:
      case 102:
        return 401;
      case 103:
        return 404;
      case 104:
        return 429;
      case 105:
        return 403;
      case 106:
        return 404;
      case 201:
      case 202:
      case 301:
      case 302:
      case 401:
      case 402:
      case 403:
      case 501:
      case 502:
      case 503:
      case 504:
      case 505:
        return 400;
      default:
        return 500;
    }
  }

  @HandleSourceError()
  async fetchQuote(pair: Pair): Promise<Quote> {
    const [base, quote] = pair;
    const { data } = await this.httpClient.get<
      ExchangeRateHostResponse | ExchangeRateHostErrorResponse
    >(API_PATH, {
      params: {
        source: base.toUpperCase(),
        currencies: quote.toUpperCase(),
      },
    });
    if (data.success === false) {
      const status = this.mapErrorCodeToHttpStatus(data.error.code);
      if (status === 401) {
        throw new SourceUnauthorizedException(this.name);
      }
      if (status === 404) {
        throw new PriceNotFoundException(pair, this.name);
      }
      throw new SourceApiException(
        this.name,
        new Error(data.error.info),
        status,
      );
    }

    const price = data?.quotes?.[`${base.toUpperCase()}${quote.toUpperCase()}`];

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
