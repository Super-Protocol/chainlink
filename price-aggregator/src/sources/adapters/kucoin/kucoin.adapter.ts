import { Injectable } from '@nestjs/common';
import { isAxiosError } from 'axios';

import { KucoinResponse, KucoinSymbolsResponse } from './kucoin.types';
import { HttpClient, HttpClientBuilder } from '../../../common';
import { AppConfigService } from '../../../config';
import { HandleSourceError } from '../../decorators';
import { PriceNotFoundException, SourceApiException } from '../../exceptions';
import {
  Pair,
  Quote,
  SourceAdapter,
  SourceAdapterConfig,
} from '../../source-adapter.interface';
import { SourceName } from '../../source-name.enum';

const BASE_URL = 'https://api.kucoin.com';
const TICKER_PATH = '/api/v1/market/orderbook/level1';
const SYMBOLS_PATH = '/api/v2/symbols';

@Injectable()
export class KucoinAdapter implements SourceAdapter {
  readonly name = SourceName.KUCOIN;
  private readonly sourceConfig: SourceAdapterConfig;
  private readonly httpClient: HttpClient;

  constructor(
    httpClientBuilder: HttpClientBuilder,
    configService: AppConfigService,
  ) {
    this.sourceConfig = configService.get('sources.kucoin');

    this.httpClient = httpClientBuilder.build({
      sourceName: this.name,
      ...this.sourceConfig,
      baseUrl: BASE_URL,
    });
  }

  getConfig(): SourceAdapterConfig {
    return this.sourceConfig;
  }

  @HandleSourceError()
  async fetchQuote(pair: Pair): Promise<Quote> {
    const symbol = this.pairToKucoinSymbol(pair);

    try {
      const { data } = await this.httpClient.get<KucoinResponse>(TICKER_PATH, {
        params: { symbol },
      });

      if (data.code !== '200000') {
        if (data.code === '400100') {
          throw new PriceNotFoundException(pair, this.name);
        }
        throw new SourceApiException(
          this.name,
          new Error(`KuCoin API error: ${data.code}`),
        );
      }

      const price = data?.data?.price;

      if (price === undefined || price === null) {
        throw new PriceNotFoundException(pair, this.name);
      }

      return {
        pair,
        price: String(price),
        receivedAt: new Date(),
      };
    } catch (error) {
      if (isAxiosError(error)) {
        if (error.response?.status === 400) {
          throw new PriceNotFoundException(pair, this.name);
        }

        if (error.response?.status === 429) {
          throw new SourceApiException(
            this.name,
            new Error('Rate limit exceeded'),
            429,
          );
        }
      }

      throw error;
    }
  }

  @HandleSourceError()
  async getPairs(): Promise<Pair[]> {
    try {
      const { data } =
        await this.httpClient.get<KucoinSymbolsResponse>(SYMBOLS_PATH);

      if (data.code !== '200000') {
        throw new SourceApiException(
          this.name,
          new Error(`KuCoin API error: ${data.code}`),
        );
      }

      if (!data?.data) {
        throw new SourceApiException(
          this.name,
          new Error('Invalid symbols response'),
        );
      }

      const pairs: Pair[] = [];
      for (const symbol of data.data) {
        if (symbol.enableTrading) {
          pairs.push([symbol.baseCurrency, symbol.quoteCurrency]);
        }
      }

      return pairs;
    } catch (error) {
      throw new SourceApiException(this.name, error as Error);
    }
  }

  private pairToKucoinSymbol(pair: Pair): string {
    return `${pair[0].toUpperCase()}-${pair[1].toUpperCase()}`;
  }
}
