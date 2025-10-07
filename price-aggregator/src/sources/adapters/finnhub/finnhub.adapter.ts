import { Injectable } from '@nestjs/common';

import { FinnhubStreamService } from './finnhub-stream.service';
import { getSymbolAndEndpoint } from './finnhub.utils';
import { HttpClient, HttpClientBuilder } from '../../../common';
import { AppConfigService } from '../../../config';
import { HandleSourceError } from '../../decorators';
import { PriceNotFoundException, SourceApiException } from '../../exceptions';
import { QuoteStreamService } from '../../quote-stream.interface';
import {
  Pair,
  Quote,
  SourceAdapter,
  SourceAdapterConfig,
} from '../../source-adapter.interface';
import { SourceName } from '../../source-name.enum';

const BASE_URL = 'https://finnhub.io';

interface FinnhubResponse {
  c: number;
  d: number | null;
  dp: number | null;
  h: number;
  l: number;
  o: number;
  pc: number;
  t: number;
  error?: string;
}

@Injectable()
export class FinnhubAdapter implements SourceAdapter {
  readonly name = SourceName.FINNHUB;
  private readonly sourceConfig: SourceAdapterConfig;
  private readonly httpClient: HttpClient;

  constructor(
    httpClientBuilder: HttpClientBuilder,
    configService: AppConfigService,
    private readonly finnhubStreamService: FinnhubStreamService,
  ) {
    this.sourceConfig = configService.get('sources.finnhub');

    this.httpClient = httpClientBuilder.build({
      sourceName: this.name,
      ...this.sourceConfig,
      baseUrl: BASE_URL,
      defaultParams: {
        token: this.sourceConfig.apiKey,
      },
    });
  }

  getConfig(): SourceAdapterConfig {
    return this.sourceConfig;
  }

  @HandleSourceError()
  async fetchQuote(pair: Pair): Promise<Quote> {
    const { symbol, endpoint } = getSymbolAndEndpoint(pair);
    const { data } = await this.httpClient.get<FinnhubResponse>(endpoint, {
      params: {
        symbol,
      },
    });

    if (data.error) {
      throw new SourceApiException(this.name, new Error(data.error));
    }

    const price = data.c;

    if (price === undefined || price === null || price === 0) {
      throw new PriceNotFoundException(pair, this.name);
    }

    return {
      pair,
      price: String(price),
      receivedAt: new Date(),
    };
  }

  getStreamService(): QuoteStreamService {
    return this.finnhubStreamService;
  }

  async closeAllStreams(): Promise<void> {
    await this.finnhubStreamService.disconnect();
  }
}
