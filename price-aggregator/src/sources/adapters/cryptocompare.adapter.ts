import { Injectable } from '@nestjs/common';
import { isAxiosError } from 'axios';

import { HttpClient, HttpClientBuilder } from '../../common';
import { AppConfigService } from '../../config';
import { PriceNotFoundException, SourceApiException } from '../exceptions';
import { Pair, Quote, SourceAdapter } from '../source-adapter.interface';
import { SourceName } from '../source-name.enum';

const BASE_URL = 'https://min-api.cryptocompare.com';
const API_PATH = '/data/price';

type CryptoCompareResponse = Record<string, number>;

@Injectable()
export class CryptoCompareAdapter implements SourceAdapter {
  readonly name = SourceName.CRYPTOCOMPARE;
  readonly enabled: boolean;
  private readonly httpClient: HttpClient;
  private readonly apiKey: string;

  constructor(
    httpClientBuilder: HttpClientBuilder,
    configService: AppConfigService,
  ) {
    const sourceConfig = configService.get('sources.cryptocompare');
    this.apiKey = sourceConfig?.apiKey || '';
    this.enabled = sourceConfig?.enabled && !!this.apiKey;

    this.httpClient = httpClientBuilder.build({
      sourceName: this.name,
      timeoutMs: sourceConfig?.timeoutMs,
      rps: sourceConfig?.rps,
      useProxy: sourceConfig?.useProxy,
      maxConcurrent: sourceConfig?.maxConcurrent,
      baseUrl: BASE_URL,
      defaultParams: {
        api_key: this.apiKey,
      },
    });
  }

  async fetchQuote(pair: Pair): Promise<Quote> {
    const [base, quote] = pair;

    try {
      const { data } = await this.httpClient.get<CryptoCompareResponse>(
        API_PATH,
        {
          params: {
            fsym: base.toUpperCase(),
            tsyms: quote.toUpperCase(),
          },
        },
      );

      const price = data?.[quote.toUpperCase()];

      if (price === undefined || price === null) {
        throw new PriceNotFoundException(pair, this.name);
      }

      return {
        pair,
        price: String(price),
        receivedAt: Date.now(),
      };
    } catch (error) {
      if (isAxiosError<{ Message?: string }>(error)) {
        const errorMessage = error.response?.data?.Message;
        if (errorMessage) {
          throw new SourceApiException(this.name, new Error(errorMessage));
        }
      }
      throw new SourceApiException(this.name, error as Error);
    }
  }
}
