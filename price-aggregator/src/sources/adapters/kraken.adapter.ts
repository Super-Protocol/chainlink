import { Injectable } from '@nestjs/common';

import { HttpClient, HttpClientBuilder } from '../../common';
import { AppConfigService } from '../../config';
import { HandleSourceError } from '../decorators';
import {
  BatchSizeExceededException,
  PriceNotFoundException,
  SourceApiException,
} from '../exceptions';
import {
  Pair,
  Quote,
  SourceAdapter,
  WithBatch,
} from '../source-adapter.interface';
import { SourceName } from '../source-name.enum';

const BASE_URL = 'https://api.kraken.com';
const API_PATH = '/0/public/Ticker';
const ASSET_PAIRS_PATH = '/0/public/AssetPairs';
const MAX_BATCH_SIZE = 50;

interface KrakenResponse {
  error: string[];
  result?: Record<
    string,
    {
      a: [string, number, number];
      b: [string, number, number];
      c: [string, string];
      v: [string, string];
      p: [string, string];
      t: [number, number];
      l: [string, string];
      h: [string, string];
      o: string;
    }
  >;
}

interface KrakenAssetPairsResponse {
  error: string[];
  result?: Record<
    string,
    {
      altname: string;
      wsname: string;
      aclass_base: string;
      base: string;
      aclass_quote: string;
      quote: string;
      lot: string;
      pair_decimals: number;
      lot_decimals: number;
      lot_multiplier: number;
      leverage_buy: number[];
      leverage_sell: number[];
      fees: number[][];
      fees_maker: number[][];
      fee_volume_currency: string;
      margin_call: number;
      margin_stop: number;
      ordermin: string;
    }
  >;
}

@Injectable()
export class KrakenAdapter implements SourceAdapter, WithBatch {
  readonly name = SourceName.KRAKEN;
  private readonly enabled: boolean;
  private readonly ttl: number;
  private readonly httpClient: HttpClient;

  constructor(
    httpClientBuilder: HttpClientBuilder,
    configService: AppConfigService,
  ) {
    const sourceConfig = configService.get('sources.kraken');
    this.enabled = sourceConfig?.enabled || false;
    this.ttl = sourceConfig?.ttl || 10000;

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

  @HandleSourceError()
  async fetchQuote(pair: Pair): Promise<Quote> {
    const krakenPair = pair.join('').toUpperCase();
    const { data } = await this.httpClient.get<KrakenResponse>(API_PATH, {
      params: {
        pair: krakenPair,
      },
    });

    if (data?.error?.length > 0) {
      if (data.error[0].includes('Unknown asset pair')) {
        throw new PriceNotFoundException(pair, this.name);
      }
      throw new SourceApiException(this.name, new Error(data.error.join(',')));
    }

    const price = data?.result?.[krakenPair]?.c?.[0];

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
      await this.httpClient.get<KrakenAssetPairsResponse>(ASSET_PAIRS_PATH);

    if (data?.error?.length > 0) {
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
    if (!pairs || pairs.length === 0) {
      return [];
    }

    if (pairs.length > MAX_BATCH_SIZE) {
      throw new BatchSizeExceededException(
        pairs.length,
        MAX_BATCH_SIZE,
        this.name,
      );
    }

    const krakenPairs = pairs.map((pair) => pair.join('').toUpperCase());
    const { data } = await this.httpClient.get<KrakenResponse>(API_PATH, {
      params: {
        pair: krakenPairs.join(','),
      },
    });

    if (data?.error?.length > 0) {
      if (data.error.some((err) => err.includes('Unknown asset pair'))) {
        return [];
      }
      throw new SourceApiException(this.name, new Error(data.error.join(',')));
    }

    const quotes: Quote[] = [];
    const now = Date.now();

    if (data?.result) {
      for (const pair of pairs) {
        const krakenPair = pair.join('').toUpperCase();
        const tickerData = data.result[krakenPair];

        if (tickerData && tickerData.c && tickerData.c[0]) {
          const price = tickerData.c[0];
          quotes.push({
            pair,
            price: String(price),
            receivedAt: now,
          });
        }
      }
    }

    return quotes;
  }
}
