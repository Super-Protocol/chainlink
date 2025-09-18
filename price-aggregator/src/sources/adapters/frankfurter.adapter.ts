import { Injectable } from '@nestjs/common';
import { isAxiosError } from 'axios';

import { HttpClient, HttpClientBuilder } from '../../common';
import { AppConfigService } from '../../config';
import { PriceNotFoundException, SourceApiException } from '../exceptions';
import { Pair, Quote, SourceAdapter } from '../source-adapter.interface';
import { SourceName } from '../source-name.enum';

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
  readonly enabled: boolean;
  private readonly httpClient: HttpClient;

  constructor(
    httpClientBuilder: HttpClientBuilder,
    configService: AppConfigService,
  ) {
    const sourceConfig = configService.get('sources.frankfurter');
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
    try {
      const { data } = await this.httpClient.get<FrankfurterResponse>(
        API_PATH,
        {
          params: {
            from: base.toUpperCase(),
            to: quote.toUpperCase(),
          },
        },
      );
      const price = data?.rates?.[quote.toUpperCase()];

      if (price === undefined || price === null) {
        throw new PriceNotFoundException(pair, this.name);
      }

      return {
        pair,
        price: String(price),
        receivedAt: Date.now(),
      };
    } catch (error) {
      if (isAxiosError(error)) {
        throw new SourceApiException(
          this.name,
          new Error(error.response?.data?.message || error.message),
        );
      }
      throw new SourceApiException(this.name, error as Error);
    }
  }
}
