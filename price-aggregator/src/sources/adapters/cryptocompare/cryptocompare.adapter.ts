import { Injectable } from '@nestjs/common';
import { isAxiosError } from 'axios';

import { CryptoCompareStreamService } from './cryptocompare-stream.service';
import { HttpClient, HttpClientBuilder } from '../../../common';
import { AppConfigService } from '../../../config';
import { HandleSourceError } from '../../decorators';
import {
  BatchSizeExceededException,
  PriceNotFoundException,
  SourceApiException,
} from '../../exceptions';
import { QuoteStreamService } from '../../quote-stream.interface';
import {
  Pair,
  Quote,
  SourceAdapter,
  SourceAdapterConfig,
} from '../../source-adapter.interface';
import { SourceName } from '../../source-name.enum';

const BASE_URL = 'https://min-api.cryptocompare.com';
const QUOTE_PATH = '/data/price';
const PRICEMULTI_PATH = '/data/pricemulti';

type CryptoCompareResponse = Record<string, number>;
type CryptoCompareMultiResponse = Record<string, Record<string, number>>;

@Injectable()
export class CryptoCompareAdapter implements SourceAdapter {
  readonly name = SourceName.CRYPTOCOMPARE;
  private readonly sourceConfig: SourceAdapterConfig;
  private readonly httpClient: HttpClient;

  constructor(
    httpClientBuilder: HttpClientBuilder,
    configService: AppConfigService,
    private readonly cryptoCompareStreamService: CryptoCompareStreamService,
  ) {
    const sourceConfig = configService.get('sources.cryptocompare');
    this.sourceConfig = {
      ...sourceConfig,
      enabled: sourceConfig.enabled && !!sourceConfig.apiKey,
    };

    this.httpClient = httpClientBuilder.build({
      sourceName: this.name,
      ...sourceConfig,
      baseUrl: BASE_URL,
      defaultParams: {
        api_key: sourceConfig.apiKey,
      },
    });
  }

  getConfig(): SourceAdapterConfig {
    return this.sourceConfig;
  }

  @HandleSourceError()
  async fetchQuote(pair: Pair): Promise<Quote> {
    if (!this.sourceConfig.apiKey) {
      throw new SourceApiException(
        this.name,
        new Error('API key is not configured'),
        401,
      );
    }

    const [base, quote] = pair;

    try {
      const { data } = await this.httpClient.get<CryptoCompareResponse>(
        QUOTE_PATH,
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
        receivedAt: new Date(),
      };
    } catch (error) {
      if (isAxiosError<{ Message?: string }>(error)) {
        const status = error.response?.status;
        const msg = error.response?.data?.Message ?? error.message;
        throw new SourceApiException(this.name, new Error(msg), status);
      }
      throw new SourceApiException(this.name, error as Error);
    }
  }

  @HandleSourceError()
  async fetchQuotes(pairs: Pair[]): Promise<Quote[]> {
    if (!this.sourceConfig.apiKey) {
      throw new SourceApiException(
        this.name,
        new Error('API key is not configured'),
        401,
      );
    }

    if (!pairs || pairs.length === 0) {
      return [];
    }

    if (pairs.length > this.sourceConfig.maxBatchSize!) {
      throw new BatchSizeExceededException(
        pairs.length,
        this.sourceConfig.maxBatchSize!,
        this.name,
      );
    }

    const baseSymbols = [...new Set(pairs.map((pair) => pair[0]))];
    const quoteSymbols = [...new Set(pairs.map((pair) => pair[1]))];

    try {
      const { data } = await this.httpClient.get<CryptoCompareMultiResponse>(
        PRICEMULTI_PATH,
        {
          params: {
            fsyms: baseSymbols.map((s) => s.toUpperCase()).join(','),
            tsyms: quoteSymbols.map((s) => s.toUpperCase()).join(','),
          },
        },
      );

      const quotes: Quote[] = [];
      const now = new Date();

      for (const pair of pairs) {
        const [base, quote] = pair;
        const baseUpper = base.toUpperCase();
        const quoteUpper = quote.toUpperCase();
        const price = data?.[baseUpper]?.[quoteUpper];

        if (price !== undefined && price !== null) {
          quotes.push({
            pair,
            price: String(price),
            receivedAt: now,
          });
        }
      }

      return quotes;
    } catch (error) {
      if (error instanceof BatchSizeExceededException) {
        throw error;
      }

      if (isAxiosError<{ Message?: string }>(error)) {
        const status = error.response?.status;
        const msg = error.response?.data?.Message ?? error.message;
        throw new SourceApiException(this.name, new Error(msg), status);
      }
      throw new SourceApiException(this.name, error as Error);
    }
  }

  getStreamService(): QuoteStreamService {
    return this.cryptoCompareStreamService;
  }

  async closeAllStreams(): Promise<void> {
    await this.cryptoCompareStreamService.disconnect();
  }
}
