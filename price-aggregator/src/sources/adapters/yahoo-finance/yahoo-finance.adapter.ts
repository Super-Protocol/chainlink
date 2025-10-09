import { Injectable } from '@nestjs/common';
import { isAxiosError } from 'axios';
import UserAgent = require('user-agents');

import { YahooFinanceResponse } from './yahoo-finance.types';
import { HttpClient, HttpClientBuilder } from '../../../common';
import { AppConfigService } from '../../../config';
import { HandleSourceError } from '../../decorators';
import { PriceNotFoundException, SourceApiException } from '../../exceptions';
import {
  Pair,
  Quote,
  SourceAdapter,
  SourceAdapterConfig,
} from '../../source-adapter.interface';
import { SourceName } from '../../source-name.enum';

const BASE_URL = 'https://query1.finance.yahoo.com';
const CHART_PATH = '/v8/finance/chart';

@Injectable()
export class YahooFinanceAdapter implements SourceAdapter {
  readonly name = SourceName.YAHOO_FINANCE;
  private readonly sourceConfig: SourceAdapterConfig;
  private readonly httpClient: HttpClient;

  constructor(
    httpClientBuilder: HttpClientBuilder,
    configService: AppConfigService,
  ) {
    this.sourceConfig = configService.get('sources.yahoofinance');

    this.httpClient = httpClientBuilder.build({
      sourceName: this.name,
      ...this.sourceConfig,
      baseUrl: BASE_URL,
    });
  }

  getConfig(): SourceAdapterConfig {
    return this.sourceConfig;
  }

  @HandleSourceError()
  async fetchQuote(pair: Pair): Promise<Quote> {
    const symbol = this.pairToYahooSymbol(pair);

    try {
      const userAgent = new UserAgent();
      const userAgentString = userAgent.toString();

      const { data } = await this.httpClient.get<YahooFinanceResponse>(
        `${CHART_PATH}/${symbol}`,
        {
          params: {
            interval: '1d',
          },
          headers: {
            'User-Agent': `${userAgentString} ${Date.now()}`,
          },
        },
      );

      if (data?.chart?.error) {
        throw new SourceApiException(
          this.name,
          new Error(
            `${data.chart.error.code}: ${data.chart.error.description}`,
          ),
        );
      }

      const result = data?.chart?.result?.[0];
      const price = result?.meta?.regularMarketPrice;

      if (price === undefined || price === null) {
        throw new PriceNotFoundException(pair, this.name);
      }

      return {
        pair,
        price: String(price),
        receivedAt: new Date(),
      };
    } catch (error) {
      if (isAxiosError(error)) {
        if (error.response?.status === 404) {
          throw new PriceNotFoundException(pair, this.name);
        }

        if (error.response?.status === 429) {
          throw new SourceApiException(
            this.name,
            new Error('Rate limit exceeded'),
            429,
          );
        }
      }

      throw error;
    }
  }

  private pairToYahooSymbol(pair: Pair): string {
    const [base, quote] = pair;
    const upperBase = base.toUpperCase();

    if (quote.toUpperCase() === 'USD' || quote.toUpperCase() === 'EUR') {
      return upperBase;
    }

    return `${upperBase}-${quote.toUpperCase()}`;
  }
}
