import { Injectable } from '@nestjs/common';

import { OkxStreamService } from './okx-stream.service';
import { HttpClient, HttpClientBuilder } from '../../../common';
import { AppConfigService } from '../../../config';
import { HandleSourceError } from '../../decorators';
import { PriceNotFoundException, SourceApiException } from '../../exceptions';
import { QuoteStreamService } from '../../quote-stream.interface';
import { Pair, Quote, SourceAdapter } from '../../source-adapter.interface';
import { SourceName } from '../../source-name.enum';

const BASE_URL = 'https://www.okx.com';
const API_PATH = '/api/v5/market/ticker';
const TICKERS_PATH = '/api/v5/market/tickers';
const INSTRUMENTS_PATH = '/api/v5/public/instruments';

interface OkxResponse {
  code: string;
  msg: string;
  data: Array<{
    instType: string;
    instId: string;
    last: string;
    lastSz: string;
    askPx: string;
    askSz: string;
    bidPx: string;
    bidSz: string;
    open24h: string;
    high24h: string;
    low24h: string;
    volCcy24h: string;
    vol24h: string;
    ts: string;
    sodUtc0: string;
    sodUtc8: string;
  }>;
}

interface OkxInstrumentsResponse {
  code: string;
  msg: string;
  data: Array<{
    instType: string;
    instId: string;
    uly: string;
    instFamily: string;
    baseCcy: string;
    quoteCcy: string;
    settleCcy: string;
    ctVal: string;
    ctMult: string;
    ctValCcy: string;
    optType: string;
    stk: string;
    listTime: string;
    expTime: string;
    lever: string;
    tickSz: string;
    lotSz: string;
    minSz: string;
    ctType: string;
    alias: string;
    state: string;
  }>;
}

@Injectable()
export class OkxAdapter implements SourceAdapter {
  readonly name = SourceName.OKX;
  private readonly enabled: boolean;
  private readonly ttl: number;
  private readonly refetch: boolean;
  private readonly maxBatchSize: number;
  private readonly httpClient: HttpClient;

  constructor(
    httpClientBuilder: HttpClientBuilder,
    configService: AppConfigService,
    private readonly okxStreamService: OkxStreamService,
  ) {
    const sourceConfig = configService.get('sources.okx');
    const { enabled, ttl, refetch, maxBatchSize } = sourceConfig;

    this.enabled = enabled;
    this.ttl = ttl;
    this.refetch = refetch;
    this.maxBatchSize = maxBatchSize;

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

  getMaxBatchSize(): number {
    return this.maxBatchSize;
  }

  @HandleSourceError()
  async fetchQuote(pair: Pair): Promise<Quote> {
    const okxPair = `${pair[0].toUpperCase()}-${pair[1].toUpperCase()}`;
    const { data } = await this.httpClient.get<OkxResponse>(API_PATH, {
      params: {
        instId: okxPair,
      },
    });

    if (data?.code !== '0') {
      if (data.code === '51001') {
        throw new PriceNotFoundException(pair, this.name);
      }
      throw new SourceApiException(this.name, new Error(data.msg));
    }

    const price = data?.data?.[0]?.last;

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
    const { data } = await this.httpClient.get<OkxInstrumentsResponse>(
      INSTRUMENTS_PATH,
      {
        params: {
          instType: 'SPOT',
        },
      },
    );

    if (data?.code !== '0') {
      throw new SourceApiException(this.name, new Error(data.msg));
    }

    if (!data?.data) {
      throw new SourceApiException(
        this.name,
        new Error('Invalid instruments response'),
      );
    }

    const pairs: Pair[] = [];
    for (const instrument of data.data) {
      if (instrument.state === 'live') {
        pairs.push([instrument.baseCcy, instrument.quoteCcy]);
      }
    }

    return pairs;
  }

  @HandleSourceError()
  async fetchQuotes(pairs: Pair[]): Promise<Quote[]> {
    if (!pairs || pairs.length === 0) {
      return [];
    }

    // OKX tickers endpoint returns all SPOT tickers at once
    const { data } = await this.httpClient.get<OkxResponse>(TICKERS_PATH, {
      params: {
        instType: 'SPOT',
      },
    });

    if (data?.code !== '0') {
      throw new SourceApiException(this.name, new Error(data.msg));
    }

    const quotes: Quote[] = [];
    const now = new Date();

    if (data?.data) {
      // Create a map for fast lookup
      const tickerMap = new Map<string, string>();
      for (const ticker of data.data) {
        if (ticker.instId && ticker.last) {
          tickerMap.set(ticker.instId, ticker.last);
        }
      }

      // Find prices for requested pairs
      for (const pair of pairs) {
        const okxInstId = `${pair[0].toUpperCase()}-${pair[1].toUpperCase()}`;
        const price = tickerMap.get(okxInstId);

        if (price) {
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

  getStreamService(): QuoteStreamService {
    return this.okxStreamService;
  }

  async closeAllStreams(): Promise<void> {
    await this.okxStreamService.disconnect();
  }
}
