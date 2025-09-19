import { Injectable } from '@nestjs/common';

import { HttpClient, HttpClientBuilder } from '../../common';
import { AppConfigService } from '../../config';
import { HandleSourceError } from '../decorators';
import { PriceNotFoundException, SourceApiException } from '../exceptions';
import { Pair, Quote, SourceAdapter } from '../source-adapter.interface';
import { SourceName } from '../source-name.enum';

const BASE_URL = 'https://api.coinbase.com';
const API_PATH = '/v2/prices';
const CURRENCIES_PATH = '/v2/currencies';

interface CoinbaseResponse {
  data: {
    base: string;
    currency: string;
    amount: string;
  };
}

interface CoinbaseCurrenciesResponse {
  data: Array<{
    id: string;
    name: string;
    min_size: string;
  }>;
}

@Injectable()
export class CoinbaseAdapter implements SourceAdapter {
  readonly name = SourceName.COINBASE;
  readonly enabled: boolean;
  private readonly httpClient: HttpClient;

  constructor(
    httpClientBuilder: HttpClientBuilder,
    configService: AppConfigService,
  ) {
    const sourceConfig = configService.get('sources.coinbase');
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

  @HandleSourceError()
  async fetchQuote(pair: Pair): Promise<Quote> {
    const { data } = await this.httpClient.get<CoinbaseResponse>(
      `${API_PATH}/${pair[0]}-${pair[1]}/spot`,
    );
    const price = data?.data?.amount;

    if (price === undefined || price === null) {
      throw new PriceNotFoundException(pair, this.name);
    }

    return {
      pair,
      price,
      receivedAt: Date.now(),
    };
  }

  @HandleSourceError()
  async getPairs(): Promise<Pair[]> {
    const { data } =
      await this.httpClient.get<CoinbaseCurrenciesResponse>(CURRENCIES_PATH);

    if (!data?.data) {
      throw new SourceApiException(
        this.name,
        new Error('Invalid currencies response'),
      );
    }

    const currencies = data.data.map((currency) => currency.id);
    const commonQuoteCurrencies = ['USD', 'EUR', 'BTC', 'ETH'];
    const pairs: Pair[] = [];

    for (const baseCurrency of currencies) {
      for (const quoteCurrency of commonQuoteCurrencies) {
        if (baseCurrency !== quoteCurrency) {
          pairs.push([baseCurrency, quoteCurrency]);
        }
      }
    }

    return pairs;
  }
}
