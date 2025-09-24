import { Injectable, Logger } from '@nestjs/common';

import {
  FinnhubTradeData,
  FinnhubWebSocketMessage,
  FinnhubSubscribeCommand,
} from './finnhub.types';
import { pairToSymbol } from './finnhub.utils';
import { WebSocketClient } from '../../../common';
import { MetricsService } from '../../../metrics/metrics.service';
import { BaseStreamService } from '../../base-stream.service';
import { StreamServiceOptions } from '../../quote-stream.interface';
import { Pair } from '../../source-adapter.interface';
import { SourceName } from '../../source-name.enum';

const WS_BASE_URL = 'wss://ws.finnhub.io';

@Injectable()
export class FinnhubStreamService extends BaseStreamService {
  protected readonly logger = new Logger(FinnhubStreamService.name);
  private readonly apiKey: string;
  private pingInterval?: NodeJS.Timeout;

  constructor(
    apiKey: string,
    options?: StreamServiceOptions,
    metricsService?: MetricsService,
  ) {
    super(options, metricsService);
    this.apiKey = apiKey;
  }

  protected getSourceName(): SourceName {
    return SourceName.FINNHUB;
  }

  protected getWsUrl(): string {
    return `${WS_BASE_URL}?token=${this.apiKey}`;
  }

  protected getWebSocketClientOptions(): Partial<
    ConstructorParameters<typeof WebSocketClient>[0]
  > {
    return { pingInterval: 0 };
  }

  protected pairToIdentifier(pair: Pair): string {
    return pairToSymbol(pair);
  }

  protected async sendSubscribeMessage(symbols: string[]): Promise<void> {
    for (const symbol of symbols) {
      const command: FinnhubSubscribeCommand = {
        type: 'subscribe',
        symbol,
      };
      this.wsClient?.send(command);
    }
  }

  protected async sendUnsubscribeMessage(symbols: string[]): Promise<void> {
    for (const symbol of symbols) {
      const command: FinnhubSubscribeCommand = {
        type: 'unsubscribe',
        symbol,
      };
      this.wsClient?.send(command);
    }
  }

  protected handleMessage(data: unknown): void {
    try {
      const message = data as FinnhubWebSocketMessage;

      if (message.type === 'ping') {
        this.handlePing();
        return;
      }

      if (message.type === 'trade' && Array.isArray(message.data)) {
        for (const trade of message.data) {
          this.handleTradeData(trade);
        }
      }
    } catch (error) {
      this.logger.error('Error handling message', error);
    }
  }

  private handleTradeData(trade: FinnhubTradeData): void {
    const symbol = trade.s;
    this.emitQuote(symbol, {
      price: String(trade.p),
      receivedAt: new Date(trade.t),
    });
  }

  private handlePing(): void {
    const pongCommand = { type: 'pong' };
    this.wsClient?.send(pongCommand);
    this.logger.debug('Sent pong response');
  }

  protected onConnect(): void {
    this.startPing();
  }

  protected onDisconnect(): void {
    this.stopPing();
  }

  private startPing(): void {
    this.stopPing();

    this.pingInterval = setInterval(() => {
      if (this.isConnected) {
        const pingCommand = { type: 'ping' };
        this.wsClient?.send(pingCommand);
        this.logger.debug('Sent ping');
      }
    }, this.options.heartbeatInterval);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = undefined;
    }
  }
}
