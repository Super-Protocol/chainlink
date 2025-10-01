import { Injectable, Logger } from '@nestjs/common';

import { OkxWebSocketMessage, OkxSubscribeRequest } from './okx.types';
import { WebSocketClient, WebSocketClientBuilder } from '../../../common';
import { AppConfigService } from '../../../config';
import { MetricsService } from '../../../metrics/metrics.service';
import { BaseStreamService } from '../../base-stream.service';
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
  private pingInterval?: NodeJS.Timeout;
  private lastMessageTime = 0;

  constructor(
    wsClientBuilder: WebSocketClientBuilder,
    appConfigService: AppConfigService,
    metricsService?: MetricsService,
  ) {
    const { stream, useProxy } = appConfigService.get('sources.okx');
    const streamConfig = {
      ...stream,
      useProxy,
    };
    super(wsClientBuilder, streamConfig, metricsService);
  }

  protected getSourceName(): SourceName {
    return SourceName.OKX;
  }

  protected getWsUrl(): string {
    return `${WS_BASE_URL}${WS_PUBLIC_PATH}`;
  }

  protected getWebSocketClientOptions(): Partial<
    ConstructorParameters<typeof WebSocketClient>[0]
  > {
    return {
      pingInterval: 0,
      parseJson: false,
    };
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
    this.lastMessageTime = Date.now();

    try {
      if (typeof data === 'string' && data === 'pong') {
        this.logger.verbose('Received pong from OKX');
        return;
      }

      if (typeof data === 'string') {
        try {
          const message = JSON.parse(data) as OkxWebSocketMessage;
          this.processOkxMessage(message);
        } catch {
          this.logger.warn('Received non-JSON string message from OKX', {
            data,
          });
        }
        return;
      }

      const message = data as OkxWebSocketMessage;
      this.processOkxMessage(message);
    } catch (error) {
      this.logger.error('Error handling OKX message', error);
    }
  }

  private processOkxMessage(message: OkxWebSocketMessage): void {
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
  }

  protected onConnect(): void {
    this.lastMessageTime = Date.now();
    this.logger.verbose('OKX connected, starting ping');
    this.startPing();
  }

  protected onDisconnect(): void {
    this.logger.verbose('OKX disconnected, stopping ping');
    this.stopPing();
  }

  private startPing(): void {
    this.stopPing();
    this.logger.verbose('Starting OKX ping timer');

    this.pingInterval = setInterval(() => {
      const now = Date.now();
      const timeSinceLastMessage = now - this.lastMessageTime;

      if (timeSinceLastMessage >= 5000 && this.isConnected) {
        this.wsClient?.send('ping');
        this.logger.verbose('Sent ping to OKX');
      }
    }, 5000);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      this.logger.verbose('Stopping OKX ping timer');
      clearInterval(this.pingInterval);
      this.pingInterval = undefined;
    }
  }
}
