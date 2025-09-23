import { Injectable } from '@nestjs/common';

import { CoinbaseStreamService } from './coinbase-stream.service';
import { HttpClient, HttpClientBuilder } from '../../../common';
import { AppConfigService } from '../../../config';
import { MetricsService } from '../../../metrics/metrics.service';
import { HandleSourceError } from '../../decorators';
import { PriceNotFoundException, SourceApiException } from '../../exceptions';
import { QuoteStreamService } from '../../quote-stream.interface';
import { Pair, Quote, SourceAdapter } from '../../source-adapter.interface';
import { SourceName } from '../../source-name.enum';

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
  private readonly enabled: boolean;
  private readonly ttl: number;
  private readonly refetch: boolean;
  private readonly httpClient: HttpClient;
  private readonly coinbaseStreamService: CoinbaseStreamService;

  constructor(
    httpClientBuilder: HttpClientBuilder,
    configService: AppConfigService,
    metricsService: MetricsService,
  ) {
    this.coinbaseStreamService = new CoinbaseStreamService(
      undefined,
      metricsService,
    );
    const sourceConfig = configService.get('sources.coinbase');
    this.enabled = sourceConfig?.enabled || false;
    this.ttl = sourceConfig?.ttl || 10000;
    this.refetch = sourceConfig?.refetch || false;

    this.httpClient = httpClientBuilder.build({
      sourceName: this.name,
      ...sourceConfig,
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
      receivedAt: new Date(),
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

  getStreamService(): QuoteStreamService {
    return this.coinbaseStreamService;
  }

  async closeAllStreams(): Promise<void> {
    await this.coinbaseStreamService.disconnect();
  }
}
