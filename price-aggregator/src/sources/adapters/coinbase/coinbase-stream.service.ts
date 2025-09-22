import { Injectable, Logger } from '@nestjs/common';

import {
  CoinbaseTickerData,
  CoinbaseWebSocketMessage,
  CoinbaseSubscribeMessage,
  CoinbaseUnsubscribeMessage,
  CoinbaseAdvancedTradeMessage,
  CoinbaseTickerEvent,
} from './coinbase.types';
import { MetricsService } from '../../../metrics/metrics.service';
import { BaseStreamService } from '../../base-stream.service';
import { StreamServiceOptions } from '../../quote-stream.interface';
import { Pair } from '../../source-adapter.interface';
import { SourceName } from '../../source-name.enum';

const WS_BASE_URL = 'wss://advanced-trade-ws.coinbase.com';
const TICKER_CHANNEL = 'ticker';

@Injectable()
export class CoinbaseStreamService extends BaseStreamService {
  protected readonly logger = new Logger(CoinbaseStreamService.name);

  constructor(options?: StreamServiceOptions, metricsService?: MetricsService) {
    super(options, metricsService);
    this.logger.verbose(
      'CoinbaseStreamService initialized with options:',
      this.options,
    );
  }

  protected getSourceName(): SourceName {
    return SourceName.COINBASE;
  }

  protected getWsUrl(): string {
    return WS_BASE_URL;
  }

  protected pairToIdentifier(pair: Pair): string {
    return `${pair[0]}-${pair[1]}`;
  }

  protected async sendSubscribeMessage(productIds: string[]): Promise<void> {
    this.logger.verbose(`Subscribing to products: [${productIds.join(', ')}]`);

    const subscribeMessage: CoinbaseSubscribeMessage = {
      type: 'subscribe',
      product_ids: productIds,
      channel: TICKER_CHANNEL,
    };

    this.wsClient?.send(subscribeMessage);
  }

  protected async sendUnsubscribeMessage(productIds: string[]): Promise<void> {
    if (productIds.length === 0) return;

    this.logger.verbose(
      `Unsubscribing from products: [${productIds.join(', ')}]`,
    );

    const unsubscribeMessage: CoinbaseUnsubscribeMessage = {
      type: 'unsubscribe',
      product_ids: productIds,
      channel: TICKER_CHANNEL,
    };

    this.wsClient?.send(unsubscribeMessage);
  }

  protected handleMessage(data: unknown): void {
    try {
      this.logger.verbose(`Raw message data: ${JSON.stringify(data)}`);

      if (data === null || data === undefined) {
        this.logger.warn('Received null or undefined message');
        return;
      }

      const message = data as CoinbaseWebSocketMessage;

      if (this.isAdvancedTradeMessage(message)) {
        this.handleAdvancedTradeMessage(message);
        return;
      }

      this.logger.verbose(`Received message type: ${message.type}`);

      if (message.type === 'ticker') {
        this.handleLegacyTickerMessage(message as CoinbaseTickerData);
      } else if (message.type === 'error') {
        this.logger.error('Coinbase WebSocket error', message);
        const error = new Error(message.message);
        this.subscriptions.forEach((sub) => {
          sub.onError?.(error);
        });
      } else if (message.type === 'subscriptions') {
        this.logger.verbose('Subscription confirmation received', message);
      } else if (message.type === 'heartbeat') {
        this.logger.verbose('Heartbeat received', message);
      } else {
        this.logger.verbose(
          `Unhandled message type: ${(message as Record<string, unknown>).type}`,
          message,
        );
      }
    } catch (error) {
      this.logger.error('Error handling message', error, { data });
    }
  }

  private isAdvancedTradeMessage(
    message: unknown,
  ): message is CoinbaseAdvancedTradeMessage {
    return (
      message &&
      typeof message === 'object' &&
      'channel' in message &&
      'events' in message
    );
  }

  private handleAdvancedTradeMessage(
    message: CoinbaseAdvancedTradeMessage,
  ): void {
    this.logger.verbose(
      `Advanced Trade message - channel: ${message.channel}, events: ${message.events.length}`,
    );

    if (message.channel === 'ticker') {
      message.events.forEach((event) => {
        if (this.isTickerEvent(event)) {
          event.tickers.forEach((ticker) => {
            this.handleTickerData(ticker, message.timestamp);
          });
        }
      });
    } else if (message.channel === 'subscriptions') {
      this.logger.verbose(
        'Advanced Trade subscription confirmation received',
        message,
      );
    } else {
      this.logger.verbose(
        `Unhandled Advanced Trade channel: ${message.channel}`,
        message,
      );
    }
  }

  private isTickerEvent(event: unknown): event is CoinbaseTickerEvent {
    return (
      event &&
      typeof event === 'object' &&
      'tickers' in event &&
      Array.isArray(event.tickers)
    );
  }

  private handleLegacyTickerMessage(tickerData: CoinbaseTickerData): void {
    this.handleTickerData(tickerData, new Date().toISOString());
  }

  private handleTickerData(
    tickerData: CoinbaseTickerData,
    timestamp: string,
  ): void {
    const productId = tickerData.product_id;
    this.logger.verbose(
      `Ticker data for ${productId}: price=${tickerData.price}, timestamp=${timestamp}`,
    );

    if (tickerData.price) {
      this.emitQuote(productId, {
        price: tickerData.price,
        receivedAt: new Date(timestamp),
      });
    } else {
      this.logger.verbose(
        `Skipping ticker: price=${tickerData.price} for product ${productId}`,
      );
    }
  }
}
