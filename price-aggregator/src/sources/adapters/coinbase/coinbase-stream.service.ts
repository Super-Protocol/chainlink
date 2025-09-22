import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';

import { Injectable, Logger } from '@nestjs/common';

import {
  CoinbaseTickerData,
  CoinbaseWebSocketMessage,
  CoinbaseSubscribeMessage,
  CoinbaseUnsubscribeMessage,
  CoinbaseAdvancedTradeMessage,
  CoinbaseTickerEvent,
} from './coinbase.types';
import { WebSocketClient } from '../../../common';
import {
  QuoteHandler,
  ErrorHandler,
  QuoteStreamService,
  StreamSubscription,
  StreamServiceOptions,
} from '../../quote-stream.interface';
import { Pair, Quote } from '../../source-adapter.interface';

const WS_BASE_URL = 'wss://advanced-trade-ws.coinbase.com';
const TICKER_CHANNEL = 'ticker';

interface Subscription {
  id: string;
  pair: Pair;
  productId: string;
  onQuote: QuoteHandler;
  onError?: ErrorHandler;
}

@Injectable()
export class CoinbaseStreamService implements QuoteStreamService {
  private readonly logger = new Logger(CoinbaseStreamService.name);
  private readonly eventEmitter = new EventEmitter();
  private wsClient: WebSocketClient | null = null;
  private subscriptions = new Map<string, Subscription>();
  private subscribedProductIds = new Set<string>();
  private productIdToPairMap = new Map<string, Pair>();
  private connectionPromise: Promise<void> | null = null;
  private readonly options: Required<StreamServiceOptions>;

  constructor(options?: StreamServiceOptions) {
    this.options = {
      autoReconnect: options?.autoReconnect ?? true,
      reconnectInterval: options?.reconnectInterval ?? 5000,
      maxReconnectAttempts: options?.maxReconnectAttempts ?? 10,
      heartbeatInterval: options?.heartbeatInterval ?? 5000,
    };
    this.logger.verbose(
      'CoinbaseStreamService initialized with options:',
      this.options,
    );
  }

  get isConnected(): boolean {
    const connected = this.wsClient?.isConnected ?? false;
    this.logger.verbose(`Connection status checked: ${connected}`);
    return connected;
  }

  get subscribedPairs(): readonly Pair[] {
    const pairs = Array.from(this.productIdToPairMap.values());
    this.logger.verbose(`Current subscribed pairs count: ${pairs.length}`);
    return pairs;
  }

  async connect(): Promise<void> {
    this.logger.verbose('Connect requested');

    if (this.connectionPromise) {
      this.logger.verbose('Connection already in progress, waiting...');
      return this.connectionPromise;
    }

    if (this.isConnected) {
      this.logger.verbose('Already connected');
      return;
    }

    this.logger.verbose('Establishing new connection...');
    this.connectionPromise = this.establishConnection();
    try {
      await this.connectionPromise;
      this.logger.verbose('Connection established successfully');
    } finally {
      this.connectionPromise = null;
    }
  }

  async disconnect(): Promise<void> {
    if (this.wsClient) {
      this.wsClient.close();
      this.wsClient = null;
    }
    this.eventEmitter.emit('connectionStateChange', false);
  }

  async subscribe(
    pair: Pair,
    onQuote: QuoteHandler,
    onError?: ErrorHandler,
  ): Promise<StreamSubscription> {
    const subscriptionId = randomUUID();
    const productId = this.pairToProductId(pair);

    this.logger.verbose(
      `Subscribe requested for pair ${pair.join('/')} (product: ${productId})`,
    );

    this.subscriptions.set(subscriptionId, {
      id: subscriptionId,
      pair,
      productId,
      onQuote,
      onError,
    });

    if (!this.subscribedProductIds.has(productId)) {
      this.logger.verbose(`New product ${productId}, subscribing...`);
      this.productIdToPairMap.set(productId, pair);
      await this.subscribeToProducts([productId]);
    } else {
      this.logger.verbose(`Product ${productId} already subscribed`);
    }

    this.logger.verbose(
      `Subscription ${subscriptionId} created for ${productId}. Total subscriptions: ${this.subscriptions.size}`,
    );

    return {
      id: subscriptionId,
      pair,
      unsubscribe: async () => {
        await this.unsubscribe(subscriptionId);
      },
    };
  }

  async unsubscribe(subscriptionId: string): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) return;

    this.subscriptions.delete(subscriptionId);

    let isProductUsedByOthers = false;
    for (const [id, sub] of Array.from(this.subscriptions.entries())) {
      if (id !== subscriptionId && sub.productId === subscription.productId) {
        isProductUsedByOthers = true;
        break;
      }
    }

    if (!isProductUsedByOthers) {
      this.productIdToPairMap.delete(subscription.productId);
      await this.unsubscribeFromProducts([subscription.productId]);
    }
  }

  async unsubscribeAll(): Promise<void> {
    const allProductIds = Array.from(this.subscribedProductIds);
    this.subscriptions.clear();
    this.productIdToPairMap.clear();

    if (allProductIds.length > 0) {
      await this.unsubscribeFromProducts(allProductIds);
    }
  }

  async addPair(pair: Pair): Promise<void> {
    const productId = this.pairToProductId(pair);

    if (!this.subscribedProductIds.has(productId)) {
      this.productIdToPairMap.set(productId, pair);
      await this.subscribeToProducts([productId]);
    }
  }

  async removePair(pair: Pair): Promise<void> {
    const productId = this.pairToProductId(pair);

    let isUsedBySubscription = false;
    for (const sub of Array.from(this.subscriptions.values())) {
      if (sub.productId === productId) {
        isUsedBySubscription = true;
        break;
      }
    }

    if (!isUsedBySubscription && this.subscribedProductIds.has(productId)) {
      this.productIdToPairMap.delete(productId);
      await this.unsubscribeFromProducts([productId]);
    }
  }

  onConnectionStateChange(handler: (connected: boolean) => void): void {
    this.eventEmitter.on('connectionStateChange', handler);
  }

  private async establishConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wsClient = new WebSocketClient({
        url: WS_BASE_URL,
        reconnect: this.options.autoReconnect,
        reconnectInterval: this.options.reconnectInterval,
        maxReconnectAttempts: this.options.maxReconnectAttempts,
        pingInterval: this.options.heartbeatInterval,
        pongTimeout: 10000,
      });

      this.setupWebSocketHandlers();

      this.wsClient.once('open', () => {
        this.logger.log('WebSocket connection established');
        this.eventEmitter.emit('connectionStateChange', true);
        resolve();
      });

      this.wsClient.once('error', (error: Error) => {
        this.logger.error('WebSocket connection error', error);
        reject(error);
      });

      this.wsClient.connect();
    });
  }

  private setupWebSocketHandlers(): void {
    if (!this.wsClient) return;

    this.wsClient.on('message', (data: unknown) => {
      this.logger.verbose('Raw WebSocket message received');
      this.handleMessage(data);
    });

    this.wsClient.on('error', (error: Error) => {
      this.logger.error('WebSocket error', error);
      this.subscriptions.forEach((sub) => {
        sub.onError?.(error);
      });
    });

    this.wsClient.on('close', () => {
      this.logger.warn('WebSocket connection closed');
      this.eventEmitter.emit('connectionStateChange', false);
    });

    this.wsClient.on('reconnect', async () => {
      this.logger.log('WebSocket reconnected, resubscribing to products');
      this.logger.verbose(
        `Reconnected with ${this.subscribedProductIds.size} products to resubscribe`,
      );
      this.eventEmitter.emit('connectionStateChange', true);
      try {
        await this.resubscribeAllProducts();
        this.logger.verbose('Resubscription completed successfully');
      } catch (error) {
        this.logger.error('Failed to resubscribe after reconnect', error);
      }
    });
  }

  private async resubscribeAllProducts(): Promise<void> {
    if (this.subscribedProductIds.size === 0) {
      this.logger.verbose('No products to resubscribe');
      return;
    }

    const productIds = Array.from(this.subscribedProductIds);
    this.logger.verbose(
      `Resubscribing to ${productIds.length} products: [${productIds.join(', ')}]`,
    );
    this.subscribedProductIds.clear();

    if (productIds.length > 0) {
      await this.subscribeToProducts(productIds);
    }
  }

  private async subscribeToProducts(productIds: string[]): Promise<void> {
    this.logger.verbose(
      `subscribeToProducts called with: [${productIds.join(', ')}]`,
    );

    if (!this.isConnected) {
      this.logger.verbose('Not connected, connecting first...');
      await this.connect();
    }

    const newProductIds = productIds.filter(
      (id) => !this.subscribedProductIds.has(id),
    );

    this.logger.verbose(`Filtered new products: [${newProductIds.join(', ')}]`);
    if (newProductIds.length === 0) {
      this.logger.verbose('No new products to subscribe to');
      return;
    }

    const subscribeMessage: CoinbaseSubscribeMessage = {
      type: 'subscribe',
      product_ids: newProductIds,
      channel: TICKER_CHANNEL,
    };

    this.logger.verbose('Sending subscribe message:', subscribeMessage);
    this.wsClient?.send(subscribeMessage);
    newProductIds.forEach((id) => this.subscribedProductIds.add(id));
    this.logger.verbose(
      `Subscribed to: ${newProductIds.join(', ')}. Total subscribed: ${this.subscribedProductIds.size}`,
    );
  }

  private async unsubscribeFromProducts(productIds: string[]): Promise<void> {
    if (productIds.length === 0) return;

    if (!this.isConnected) {
      productIds.forEach((id) => this.subscribedProductIds.delete(id));
      return;
    }

    const unsubscribeMessage: CoinbaseUnsubscribeMessage = {
      type: 'unsubscribe',
      product_ids: productIds,
      channel: TICKER_CHANNEL,
    };

    this.wsClient?.send(unsubscribeMessage);
    productIds.forEach((id) => this.subscribedProductIds.delete(id));
    this.logger.debug(`Unsubscribed from: ${productIds.join(', ')}`);
  }

  private handleMessage(data: unknown): void {
    try {
      this.logger.verbose(`Raw message data type: ${typeof data}`);
      this.logger.verbose(`Raw message data: ${JSON.stringify(data)}`);

      if (data === null || data === undefined) {
        this.logger.warn('Received null or undefined message');
        return;
      }

      const message = data as CoinbaseWebSocketMessage;

      // Handle new Advanced Trade API format
      if (this.isAdvancedTradeMessage(message)) {
        this.handleAdvancedTradeMessage(message);
        return;
      }

      // Handle legacy format
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
      message.events.forEach((event, index) => {
        if (this.isTickerEvent(event)) {
          this.logger.verbose(
            `Processing ticker event ${index + 1}/${message.events.length}, type: ${event.type}, tickers: ${event.tickers.length}`,
          );

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
    const pair = this.productIdToPairMap.get(tickerData.product_id);

    this.logger.verbose(
      `Ticker data for ${tickerData.product_id}: price=${tickerData.price}, timestamp=${timestamp}`,
    );

    if (pair && tickerData.price) {
      const quote: Quote = {
        pair,
        price: tickerData.price,
        receivedAt: new Date(timestamp),
      };

      let handlerCount = 0;
      this.subscriptions.forEach((sub) => {
        if (sub.productId === tickerData.product_id) {
          this.logger.verbose(
            `Calling quote handler for subscription ${sub.id}`,
          );
          sub.onQuote(quote);
          handlerCount++;
        }
      });

      this.logger.verbose(
        `Quote delivered to ${handlerCount} handlers for ${tickerData.product_id}`,
      );
    } else {
      this.logger.verbose(
        `Skipping ticker: pair=${!!pair}, price=${tickerData.price} for product ${tickerData.product_id}`,
      );
    }
  }

  private pairToProductId(pair: Pair): string {
    return `${pair[0]}-${pair[1]}`;
  }
}
