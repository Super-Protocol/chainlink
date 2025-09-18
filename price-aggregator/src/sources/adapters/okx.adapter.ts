import { Injectable } from '@nestjs/common';
import { isAxiosError } from 'axios';

import { HttpClient, HttpClientBuilder } from '../../common';
import { AppConfigService } from '../../config';
import {
  PriceNotFoundException,
  SourceApiException,
  UnsupportedPairException,
} from '../exceptions';
import { Pair, Quote, SourceAdapter } from '../source-adapter.interface';
import { SourceName } from '../source-name.enum';

const BASE_URL = 'https://www.okx.com';
const API_PATH = '/api/v5/market/ticker';

interface OkxResponse {
  code: string;
  msg: string;
  data: [
    {
      instType: string;
      instId: string;
      last: string;
      lastSz: string;
      askPx: string;
      askSz: string;
      bidPx: string;
      bidSz: string;
      open24h: string;
      high24h: string;
      low24h: string;
      volCcy24h: string;
      vol24h: string;
      ts: string;
      sodUtc0: string;
      sodUtc8: string;
    },
  ];
}

@Injectable()
export class OkxAdapter implements SourceAdapter {
  readonly name = SourceName.OKX;
  readonly enabled: boolean;
  private readonly httpClient: HttpClient;

  constructor(
    httpClientBuilder: HttpClientBuilder,
    configService: AppConfigService,
  ) {
    const sourceConfig = configService.get('sources.okx');
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
    const okxPair = `${pair[0].toUpperCase()}-${pair[1].toUpperCase()}`;
    try {
      const { data } = await this.httpClient.get<OkxResponse>(API_PATH, {
        params: {
          instId: okxPair,
        },
      });

      if (data?.code !== '0') {
        throw new SourceApiException(this.name, new Error(data.msg));
      }

      const price = data?.data?.[0]?.last;

      if (price === undefined || price === null) {
        throw new PriceNotFoundException(pair, this.name);
      }

      return {
        pair,
        price,
        receivedAt: Date.now(),
      };
    } catch (error) {
      if (
        isAxiosError(error) &&
        (error.response?.data as any)?.code === '51001'
      ) {
        throw new UnsupportedPairException(pair, this.name);
      }
      throw new SourceApiException(this.name, error as Error);
    }
  }
}
