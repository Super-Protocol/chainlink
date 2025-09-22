import { Injectable } from '@nestjs/common';

import { KrakenStreamService } from './kraken-stream.service';
import { KrakenResponse, KrakenAssetPairsResponse } from './kraken.types';
import { HttpClient, HttpClientBuilder } from '../../../common';
import { AppConfigService } from '../../../config';
import { MetricsService } from '../../../metrics/metrics.service';
import { HandleSourceError } from '../../decorators';
import {
  BatchSizeExceededException,
  PriceNotFoundException,
  SourceApiException,
} from '../../exceptions';
import { QuoteStreamService } from '../../quote-stream.interface';
import { Pair, Quote, SourceAdapter } from '../../source-adapter.interface';
import { SourceName } from '../../source-name.enum';

const BASE_URL = 'https://api.kraken.com';
const API_PATH = '/0/public/Ticker';
const ASSET_PAIRS_PATH = '/0/public/AssetPairs';

@Injectable()
export class KrakenAdapter implements SourceAdapter {
  readonly name = SourceName.KRAKEN;
  private readonly enabled: boolean;
  private readonly ttl: number;
  private readonly refetch: boolean;
  private readonly maxBatchSize: number;
  private readonly httpClient: HttpClient;
  private readonly krakenStreamService: KrakenStreamService;

  constructor(
    httpClientBuilder: HttpClientBuilder,
    configService: AppConfigService,
    metricsService: MetricsService,
  ) {
    const sourceConfig = configService.get('sources.kraken');
    this.enabled = sourceConfig?.enabled || false;
    this.ttl = sourceConfig?.ttl || 10000;
    this.refetch = sourceConfig?.refetch || false;
    this.maxBatchSize = sourceConfig.batchConfig?.maxBatchSize ?? 50;
    this.krakenStreamService = new KrakenStreamService(
      undefined,
      metricsService,
    );

    this.httpClient = httpClientBuilder.build({
      sourceName: this.name,
      timeoutMs: sourceConfig?.timeoutMs,
      rps: sourceConfig?.rps,
      useProxy: sourceConfig?.useProxy,
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
    const krakenPair = this.pairToKrakenFormat(pair);
    const { data } = await this.httpClient.get<KrakenResponse>(API_PATH, {
      params: {
        pair: krakenPair,
      },
    });

    this.handleApiErrors(data, pair);

    const resultKey = Object.keys(data?.result || {})[0];
    const price = data?.result?.[resultKey]?.c?.[0];

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
      await this.httpClient.get<KrakenAssetPairsResponse>(ASSET_PAIRS_PATH);

    if (this.hasApiErrors(data)) {
      throw new SourceApiException(this.name, new Error(data.error.join(',')));
    }

    if (!data?.result) {
      throw new SourceApiException(
        this.name,
        new Error('Invalid asset pairs response'),
      );
    }

    const pairs: Pair[] = [];
    for (const [, pairInfo] of Object.entries(data.result)) {
      pairs.push(pairInfo.wsname.split('/') as Pair);
    }

    return pairs;
  }

  @HandleSourceError()
  async fetchQuotes(pairs: Pair[]): Promise<Quote[]> {
    if (!pairs?.length) {
      return [];
    }

    if (pairs.length > this.maxBatchSize) {
      throw new BatchSizeExceededException(
        pairs.length,
        this.maxBatchSize,
        this.name,
      );
    }

    const krakenPairs = pairs.map((pair) => this.pairToKrakenFormat(pair));
    const { data } = await this.httpClient.get<KrakenResponse>(API_PATH, {
      params: {
        pair: krakenPairs.join(','),
      },
    });

    if (this.hasApiErrors(data)) {
      if (data.error.some((err) => err.includes('Unknown asset pair'))) {
        return [];
      }
      throw new SourceApiException(this.name, new Error(data.error.join(',')));
    }

    const quotes: Quote[] = [];
    const now = new Date();

    if (data?.result) {
      const pairToKrakenMap = new Map(
        pairs.map((pair) => [this.pairToKrakenFormat(pair), pair]),
      );

      for (const [resultKey, tickerData] of Object.entries(data.result)) {
        const originalPair =
          pairToKrakenMap.get(resultKey) ||
          pairs.find((pair) => this.pairToKrakenFormat(pair) === resultKey);

        if (originalPair && tickerData && tickerData.c && tickerData.c[0]) {
          const price = tickerData.c[0];
          quotes.push({
            pair: originalPair,
            price: String(price),
            receivedAt: now,
          });
        }
      }
    }

    return quotes;
  }

  getStreamService(): QuoteStreamService {
    return this.krakenStreamService;
  }

  async closeAllStreams(): Promise<void> {
    await this.krakenStreamService.disconnect();
  }

  private pairToKrakenFormat(pair: Pair): string {
    const [base, quote] = pair;
    return `${base}${quote}`;
  }

  private hasApiErrors(
    data?: KrakenResponse | KrakenAssetPairsResponse,
  ): boolean {
    return Boolean(data?.error?.length);
  }

  private handleApiErrors(data?: KrakenResponse, pair?: Pair): void {
    if (!this.hasApiErrors(data)) return;

    if (pair && data!.error[0].includes('Unknown asset pair')) {
      throw new PriceNotFoundException(pair, this.name);
    }
    throw new SourceApiException(this.name, new Error(data!.error.join(',')));
  }
}
