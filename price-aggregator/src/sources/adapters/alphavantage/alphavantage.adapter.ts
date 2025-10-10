import { Injectable } from '@nestjs/common';

import { HttpClient, HttpClientBuilder } from '../../../common';
import { AppConfigService } from '../../../config';
import { HandleSourceError } from '../../decorators';
import {
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
  private readonly sourceConfig: SourceAdapterConfig;
  private readonly httpClient: HttpClient;

  constructor(
    httpClientBuilder: HttpClientBuilder,
    configService: AppConfigService,
  ) {
    const sourceConfig = configService.get('sources.alphavantage');
    this.sourceConfig = {
      ...sourceConfig,
      enabled: sourceConfig.enabled && !!sourceConfig.apiKey,
    };

    this.httpClient = httpClientBuilder.build({
      sourceName: this.name,
      ...sourceConfig,
      baseUrl: BASE_URL,
      defaultParams: {
        apikey: sourceConfig.apiKey,
      },
    });
  }

  getConfig(): SourceAdapterConfig {
    return this.sourceConfig;
  }

  @HandleSourceError()
  async fetchQuote(pair: Pair): Promise<Quote> {
    if (!this.sourceConfig.apiKey) {
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
      const lower = errorMessage.toLowerCase();
      if (lower.includes('api key')) {
        throw new SourceUnauthorizedException(this.name);
      }
      if (
        lower.includes('invalid') ||
        lower.includes('not available') ||
        lower.includes('not supported')
      ) {
        throw new PriceNotFoundException(pair, this.name);
      }
      throw new SourceApiException(this.name, new Error(errorMessage), 502);
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
