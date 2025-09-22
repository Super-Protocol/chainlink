import { Injectable, Logger } from '@nestjs/common';

import { OkxWebSocketMessage, OkxSubscribeRequest } from './okx.types';
import { MetricsService } from '../../../metrics/metrics.service';
import { BaseStreamService } from '../../base-stream.service';
import { StreamServiceOptions } from '../../quote-stream.interface';
import { Pair, Quote } from '../../source-adapter.interface';
import { SourceName } from '../../source-name.enum';

const WS_BASE_URL = 'wss://ws.okx.com:8443';
const WS_PUBLIC_PATH = '/ws/v5/public';
const SUBSCRIBE_OP = 'subscribe';
const UNSUBSCRIBE_OP = 'unsubscribe';
const TICKERS_CHANNEL = 'tickers';

@Injectable()
export class OkxStreamService extends BaseStreamService {
  protected readonly logger = new Logger(OkxStreamService.name);

  constructor(options?: StreamServiceOptions, metricsService?: MetricsService) {
    super(options, metricsService);
  }

  protected getSourceName(): SourceName {
    return SourceName.OKX;
  }

  protected getWsUrl(): string {
    return `${WS_BASE_URL}${WS_PUBLIC_PATH}`;
  }

  protected pairToIdentifier(pair: Pair): string {
    return `${pair[0].toUpperCase()}-${pair[1].toUpperCase()}`;
  }

  protected async sendSubscribeMessage(identifiers: string[]): Promise<void> {
    const command: OkxSubscribeRequest = {
      op: SUBSCRIBE_OP,
      args: identifiers.map((instId) => ({
        channel: TICKERS_CHANNEL,
        instId,
      })),
    };

    this.wsClient?.send(command);
  }

  protected async sendUnsubscribeMessage(identifiers: string[]): Promise<void> {
    const command: OkxSubscribeRequest = {
      op: UNSUBSCRIBE_OP,
      args: identifiers.map((instId) => ({
        channel: TICKERS_CHANNEL,
        instId,
      })),
    };

    this.wsClient?.send(command);
  }

  protected handleMessage(data: unknown): void {
    try {
      const message = data as OkxWebSocketMessage;

      if (message.event === 'subscribe') {
        this.logger.debug('OKX subscribe confirmation received');
        return;
      }

      if (message.event === 'unsubscribe') {
        this.logger.debug('OKX unsubscribe confirmation received');
        return;
      }

      if (message.event === 'error') {
        this.logger.error('OKX WebSocket error event', {
          code: message.code,
          msg: message.msg,
        });
        return;
      }

      if (message.arg?.channel === TICKERS_CHANNEL && message.data) {
        for (const tickerData of message.data) {
          if (tickerData.instId && tickerData.last) {
            const pair = this.identifierToPairMap.get(tickerData.instId);
            if (pair) {
              const quote: Quote = {
                pair,
                price: String(tickerData.last),
                receivedAt: new Date(parseInt(tickerData.ts, 10)),
              };

              this.emitQuote(tickerData.instId, quote);
            }
          }
        }
      }
    } catch (error) {
      this.logger.error('Error handling OKX message', error);
    }
  }
}
