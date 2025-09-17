import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';

import { AppConfigService } from '../../config';
import {
  PriceNotFoundException,
  FeatureNotImplementedException,
  SourceApiException,
} from '../exceptions';
import {
  Pair,
  Quote,
  SourceAdapter,
  WithBatch,
  WithWebSocket,
} from '../source-adapter.interface';
import { SourceName } from '../source-name.enum';

const BASE_URL = 'https://www.okx.com/api/v5/market/ticker';

@Injectable()
export class OkxAdapter implements SourceAdapter, WithBatch, WithWebSocket {
  readonly name = SourceName.OKX;
  readonly enabled: boolean;

  constructor(
    private readonly httpService: HttpService,
    configService: AppConfigService,
  ) {
    this.enabled = configService.get('sources.okx.enabled');
  }

  async fetchQuote(pair: Pair): Promise<Quote> {
    try {
      const okxPair = pair.join('-');
      const { data } = await firstValueFrom(
        this.httpService.get(BASE_URL, {
          params: { instId: okxPair },
        }),
      );

      const item = data?.data?.[0];
      if (!item || item.last === undefined) {
        throw new PriceNotFoundException(pair, this.name);
      }

      return {
        pair,
        price: String(item.last),
        receivedAt: Date.now(),
      };
    } catch (error) {
      if (error instanceof PriceNotFoundException) {
        throw error;
      }
      throw new SourceApiException(this.name, error as Error);
    }
  }

  async fetchQuotes(_pairs: Pair[]): Promise<Quote[]> {
    throw new FeatureNotImplementedException('this feature', this.name);
  }

  streamQuotes(_pairs: Pair[]): AsyncIterable<Quote> {
    throw new FeatureNotImplementedException('this feature', this.name);
  }
}
