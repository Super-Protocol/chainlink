import { Injectable } from '@nestjs/common';

import { HttpClient, HttpClientBuilder } from '../../../common';
import { AppConfigService } from '../../../config';
import { HandleSourceError } from '../../decorators';
import { PriceNotFoundException, SourceApiException } from '../../exceptions';
import { Pair, Quote, SourceAdapter } from '../../source-adapter.interface';
import { SourceName } from '../../source-name.enum';

const BASE_URL = 'https://www.alphavantage.co';
const GET_QUOTE_ENDPOINT = '/query';

interface AlphaVantageResponse {
  'Realtime Currency Exchange Rate'?: {
    '1. From_Currency Code': string;
    '2. From_Currency Name': string;
    '3. To_Currency Code': string;
    '4. To_Currency Name': string;
    '5. Exchange Rate': string;
    '6. Last Refreshed': string;
    '7. Time Zone': string;
    '8. Bid Price': string;
    '9. Ask Price': string;
  };
  'Error Message'?: string;
  Note?: string;
}

function splitPair(pair: Pair): { base: string; quote: string } {
  const [base, quote] = pair;
  return { base: base.toUpperCase(), quote: quote.toUpperCase() };
}

@Injectable()
export class AlphaVantageAdapter implements SourceAdapter {
  readonly name = SourceName.ALPHAVANTAGE;
  private readonly enabled: boolean;
  private readonly ttl: number;
  private readonly refetch: boolean;
  private readonly httpClient: HttpClient;
  private readonly apiKey: string;

  constructor(
    httpClientBuilder: HttpClientBuilder,
    configService: AppConfigService,
  ) {
    const sourceConfig = configService.get('sources.alphavantage');
    this.apiKey = sourceConfig?.apiKey || '';
    this.enabled = sourceConfig?.enabled && !!this.apiKey;
    this.ttl = sourceConfig?.ttl || 10000;
    this.refetch = sourceConfig?.refetch || false;

    this.httpClient = httpClientBuilder.build({
      sourceName: this.name,
      timeoutMs: sourceConfig?.timeoutMs,
      rps: sourceConfig?.rps,
      useProxy: sourceConfig?.useProxy,
      maxConcurrent: sourceConfig?.maxConcurrent,
      baseUrl: BASE_URL,
      defaultParams: {
        apikey: this.apiKey,
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
    if (!this.apiKey) {
      throw new SourceApiException(
        this.name,
        new Error('API key is not configured'),
        401,
      );
    }

    const { base, quote } = splitPair(pair);
    const { data } = await this.httpClient.get<AlphaVantageResponse>(
      GET_QUOTE_ENDPOINT,
      {
        params: {
          function: 'CURRENCY_EXCHANGE_RATE',
          from_currency: base,
          to_currency: quote,
        },
      },
    );

    if (data?.['Error Message']) {
      const errorMessage = data['Error Message'];
      const statusCode = errorMessage.toLowerCase().includes('invalid')
        ? 400
        : 502;
      throw new SourceApiException(
        this.name,
        new Error(errorMessage),
        statusCode,
      );
    }

    if (data?.Note) {
      throw new SourceApiException(
        this.name,
        new Error('Rate limit exceeded'),
        429,
      );
    }

    const exchangeRate = data?.['Realtime Currency Exchange Rate'];
    const price = exchangeRate?.['5. Exchange Rate'];

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
