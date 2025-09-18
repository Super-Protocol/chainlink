import { Injectable } from '@nestjs/common';

import { HttpClient, HttpClientBuilder } from '../../common';
import { AppConfigService } from '../../config';
import {
  PriceNotFoundException,
  SourceApiException,
  UnsupportedPairException,
} from '../exceptions';
import { Pair, Quote, SourceAdapter } from '../source-adapter.interface';
import { SourceName } from '../source-name.enum';

const BASE_URL = 'https://api.kraken.com';
const API_PATH = '/0/public/Ticker';

interface KrakenResponse {
  error: string[];
  result?: Record<
    string,
    {
      a: [string, number, number];
      b: [string, number, number];
      c: [string, string];
      v: [string, string];
      p: [string, string];
      t: [number, number];
      l: [string, string];
      h: [string, string];
      o: string;
    }
  >;
}

@Injectable()
export class KrakenAdapter implements SourceAdapter {
  readonly name = SourceName.KRAKEN;
  readonly enabled: boolean;
  private readonly httpClient: HttpClient;

  constructor(
    httpClientBuilder: HttpClientBuilder,
    configService: AppConfigService,
  ) {
    const sourceConfig = configService.get('sources.kraken');
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
    const krakenPair = pair.join('').toUpperCase();
    try {
      const { data } = await this.httpClient.get<KrakenResponse>(API_PATH, {
        params: {
          pair: krakenPair,
        },
      });

      if (data?.error?.length > 0) {
        if (data.error[0].includes('Unknown asset pair')) {
          throw new UnsupportedPairException(pair, this.name);
        }
        throw new SourceApiException(
          this.name,
          new Error(data.error.join(',')),
        );
      }

      const price = data?.result?.[krakenPair]?.c?.[0];

      if (price === undefined || price === null) {
        throw new PriceNotFoundException(pair, this.name);
      }

      return {
        pair,
        price,
        receivedAt: Date.now(),
      };
    } catch (error) {
      if (error instanceof UnsupportedPairException) {
        throw error;
      }
      throw new SourceApiException(this.name, error as Error);
    }
  }
}
