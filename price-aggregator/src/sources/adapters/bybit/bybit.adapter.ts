import { Injectable } from '@nestjs/common';
import { isAxiosError } from 'axios';

import { BybitResponse, BybitInstrumentsResponse } from './bybit.types';
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

const BASE_URL = 'https://api.bybit.com';
const TICKERS_PATH = '/v5/market/tickers';
const INSTRUMENTS_PATH = '/v5/market/instruments-info';

@Injectable()
export class BybitAdapter implements SourceAdapter {
  readonly name = SourceName.BYBIT;
  private readonly sourceConfig: SourceAdapterConfig;
  private readonly httpClient: HttpClient;

  constructor(
    httpClientBuilder: HttpClientBuilder,
    configService: AppConfigService,
  ) {
    this.sourceConfig = configService.get('sources.bybit');

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
    const symbol = this.pairToBybitSymbol(pair);

    try {
      const { data } = await this.httpClient.get<BybitResponse>(TICKERS_PATH, {
        params: {
          category: 'spot',
          symbol,
        },
      });

      if (data.retCode !== 0) {
        if (data.retCode === 10001) {
          throw new PriceNotFoundException(pair, this.name);
        }
        throw new SourceApiException(
          this.name,
          new Error(`Bybit API error: ${data.retMsg}`),
        );
      }

      const ticker = data?.result?.list?.[0];
      const price = ticker?.lastPrice;

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
        if (error.response?.status === 400 || error.response?.status === 404) {
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
      const { data } = await this.httpClient.get<BybitInstrumentsResponse>(
        INSTRUMENTS_PATH,
        {
          params: {
            category: 'spot',
            limit: 1000,
          },
        },
      );

      if (data.retCode !== 0) {
        throw new SourceApiException(
          this.name,
          new Error(`Bybit API error: ${data.retMsg}`),
        );
      }

      if (!data?.result?.list) {
        throw new SourceApiException(
          this.name,
          new Error('Invalid instruments response'),
        );
      }

      const pairs: Pair[] = [];
      for (const instrument of data.result.list) {
        if (instrument.status === 'Trading') {
          pairs.push([instrument.baseCoin, instrument.quoteCoin]);
        }
      }

      return pairs;
    } catch (error) {
      throw new SourceApiException(this.name, error as Error);
    }
  }

  private pairToBybitSymbol(pair: Pair): string {
    return pair.map((p) => p.toUpperCase()).join('');
  }
}
