import { Injectable } from '@nestjs/common';

import { HttpClient, HttpClientBuilder } from '../../../common';
import { AppConfigService } from '../../../config';
import { HandleSourceError } from '../../decorators';
import { PriceNotFoundException, SourceApiException } from '../../exceptions';
import { Pair, Quote, SourceAdapter } from '../../source-adapter.interface';
import { SourceName } from '../../source-name.enum';

const BASE_URL = 'https://api.exchangerate.host';
const API_PATH = '/latest';

interface ExchangeRateHostResponse {
  motd: {
    msg: string;
    url: string;
  };
  success: true;
  base: string;
  date: string;
  rates: Record<string, number>;
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

  constructor(
    httpClientBuilder: HttpClientBuilder,
    configService: AppConfigService,
  ) {
    const sourceConfig = configService.get('sources.exchangeratehost');
    this.enabled = sourceConfig?.enabled || false;
    this.ttl = sourceConfig?.ttl || 10000;
    this.refetch = sourceConfig?.refetch || false;

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
        base: base.toUpperCase(),
        symbols: quote.toUpperCase(),
      },
    });
    if (data.success === false) {
      throw new SourceApiException(
        this.name,
        new Error(data.error.info),
        this.mapErrorCodeToHttpStatus(data.error.code),
      );
    }

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
