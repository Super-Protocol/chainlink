import { Injectable } from '@nestjs/common';
import { isAxiosError } from 'axios';

import { BinanceStreamService } from './binance-stream.service';
import { HttpClient, HttpClientBuilder } from '../../../common';
import { AppConfigService } from '../../../config';
import { HandleSourceError } from '../../decorators';
import { PriceNotFoundException, SourceApiException } from '../../exceptions';
import { QuoteStreamService } from '../../quote-stream.interface';
import { Pair, Quote, SourceAdapter } from '../../source-adapter.interface';
import { SourceName } from '../../source-name.enum';

const BASE_URL = 'https://api.binance.com';
const API_PATH = '/api/v3/ticker/price';
const EXCHANGE_INFO_PATH = '/api/v3/exchangeInfo';

@Injectable()
export class BinanceAdapter implements SourceAdapter {
  readonly name = SourceName.BINANCE;
  private readonly enabled: boolean;
  private readonly ttl: number;
  private readonly refetch: boolean;
  private readonly maxBatchSize: number;
  private readonly httpClient: HttpClient;
  private readonly binanceStreamService: BinanceStreamService;

  constructor(
    httpClientBuilder: HttpClientBuilder,
    configService: AppConfigService,
  ) {
    this.binanceStreamService = new BinanceStreamService();
    const sourceConfig = configService.get('sources.binance');
    this.enabled = sourceConfig?.enabled || false;
    this.ttl = sourceConfig?.ttl || 10000;
    this.refetch = sourceConfig?.refetch || false;
    this.maxBatchSize = sourceConfig.batchConfig?.maxBatchSize ?? 500;

    this.httpClient = httpClientBuilder.build({
      sourceName: 'binance',
      timeoutMs: sourceConfig?.timeoutMs || 10000,
      rps: sourceConfig?.rps,
      useProxy: sourceConfig?.useProxy || false,
      maxConcurrent: sourceConfig?.maxConcurrent,
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

  getMaxBatchSize(): number {
    return this.maxBatchSize;
  }

  @HandleSourceError()
  async fetchQuote(pair: Pair): Promise<Quote> {
    const { data } = await this.httpClient.get<{ price: string }>(API_PATH, {
      params: { symbol: pair.join('') },
    });
    const price = data?.price;
    if (price === undefined || price === null) {
      throw new PriceNotFoundException(pair, this.name);
    }
    const now = new Date();

    return {
      pair,
      price: String(price),
      receivedAt: now,
    };
  }

  @HandleSourceError()
  async fetchQuotes(pairs: Pair[]): Promise<Quote[]> {
    if (!pairs || pairs.length === 0) {
      return [];
    }

    try {
      const { data } =
        await this.httpClient.get<Array<{ symbol: string; price: string }>>(
          API_PATH,
        );

      const quotes: Quote[] = [];
      const now = new Date();
      const priceMap = new Map<string, string>();

      if (Array.isArray(data)) {
        for (const item of data) {
          if (item.symbol && item.price) {
            priceMap.set(item.symbol, item.price);
          }
        }
      }

      for (const pair of pairs) {
        const symbol = pair.join('');
        const price = priceMap.get(symbol);

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
      if (isAxiosError(error)) {
        if (error.response?.status === 400) {
          return [];
        }
      }

      throw new SourceApiException(this.name, error as Error);
    }
  }

  getStreamService(): QuoteStreamService {
    return this.binanceStreamService;
  }

  async closeAllStreams(): Promise<void> {
    await this.binanceStreamService.disconnect();
  }

  async getPairs(): Promise<Pair[]> {
    try {
      const { data } = await this.httpClient.get<{
        symbols: Array<{
          symbol: string;
          baseAsset: string;
          quoteAsset: string;
          status: string;
        }>;
      }>(EXCHANGE_INFO_PATH);

      if (!data?.symbols) {
        throw new SourceApiException(
          this.name,
          new Error('Invalid exchange info response'),
        );
      }

      return data.symbols
        .filter((symbol) => symbol.status === 'TRADING')
        .map((symbol) => [symbol.baseAsset, symbol.quoteAsset] as Pair);
    } catch (error) {
      throw new SourceApiException(this.name, error as Error);
    }
  }
}
