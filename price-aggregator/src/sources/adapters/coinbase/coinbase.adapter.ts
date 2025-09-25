import { Injectable } from '@nestjs/common';

import { CoinbaseStreamService } from './coinbase-stream.service';
import { HttpClient, HttpClientBuilder } from '../../../common';
import { AppConfigService } from '../../../config';
import { HandleSourceError } from '../../decorators';
import { PriceNotFoundException } from '../../exceptions';
import { QuoteStreamService } from '../../quote-stream.interface';
import { Pair, Quote, SourceAdapter } from '../../source-adapter.interface';
import { SourceName } from '../../source-name.enum';

const BASE_URL = 'https://api.coinbase.com';
const API_PATH = '/v2/prices';

interface CoinbaseResponse {
  data: {
    base: string;
    currency: string;
    amount: string;
  };
}

@Injectable()
export class CoinbaseAdapter implements SourceAdapter {
  readonly name = SourceName.COINBASE;
  private readonly enabled: boolean;
  private readonly ttl: number;
  private readonly refetch: boolean;
  private readonly httpClient: HttpClient;

  constructor(
    httpClientBuilder: HttpClientBuilder,
    configService: AppConfigService,
    private readonly coinbaseStreamService: CoinbaseStreamService,
  ) {
    const sourceConfig = configService.get('sources.coinbase');
    const { enabled, ttl, refetch } = sourceConfig;
    this.enabled = enabled;
    this.ttl = ttl;
    this.refetch = refetch;

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

  getStreamService(): QuoteStreamService {
    return this.coinbaseStreamService;
  }

  async closeAllStreams(): Promise<void> {
    await this.coinbaseStreamService.disconnect();
  }
}
