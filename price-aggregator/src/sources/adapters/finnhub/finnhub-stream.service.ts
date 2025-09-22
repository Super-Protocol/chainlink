import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';

import { Injectable, Logger } from '@nestjs/common';

import {
  FinnhubTradeData,
  FinnhubWebSocketMessage,
  FinnhubSubscribeCommand,
} from './finnhub.types';
import { pairToSymbol } from './finnhub.utils';
import { WebSocketClient } from '../../../common';
import {
  QuoteHandler,
  ErrorHandler,
  QuoteStreamService,
  StreamSubscription,
  StreamServiceOptions,
} from '../../quote-stream.interface';
import { Pair, Quote } from '../../source-adapter.interface';

const WS_BASE_URL = 'wss://ws.finnhub.io';

interface Subscription {
  id: string;
  pair: Pair;
  symbol: string;
  onQuote: QuoteHandler;
  onError?: ErrorHandler;
}

@Injectable()
export class FinnhubStreamService implements QuoteStreamService {
  private readonly logger = new Logger(FinnhubStreamService.name);
  private readonly eventEmitter = new EventEmitter();
  private wsClient: WebSocketClient | null = null;
  private subscriptions = new Map<string, Subscription>();
  private subscribedSymbols = new Set<string>();
  private symbolToPairMap = new Map<string, Pair>();
  private connectionPromise: Promise<void> | null = null;
  private readonly options: Required<StreamServiceOptions>;
  private readonly apiKey: string;
  private pingInterval?: NodeJS.Timeout;

  constructor(apiKey: string, options?: StreamServiceOptions) {
    this.apiKey = apiKey;
    this.options = {
      autoReconnect: options?.autoReconnect ?? true,
      reconnectInterval: options?.reconnectInterval ?? 5000,
      maxReconnectAttempts: options?.maxReconnectAttempts ?? 10,
      heartbeatInterval: options?.heartbeatInterval ?? 30000,
    };
  }

  get isConnected(): boolean {
    return this.wsClient?.isConnected ?? false;
  }

  get subscribedPairs(): readonly Pair[] {
    return Array.from(this.symbolToPairMap.values());
  }

  async connect(): Promise<void> {
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    if (this.isConnected) {
      return;
    }

    this.connectionPromise = this.establishConnection();
    try {
      await this.connectionPromise;
    } finally {
      this.connectionPromise = null;
    }
  }

  async disconnect(): Promise<void> {
    this.stopPing();

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
    const symbol = pairToSymbol(pair);

    this.subscriptions.set(subscriptionId, {
      id: subscriptionId,
      pair,
      symbol,
      onQuote,
      onError,
    });

    if (!this.subscribedSymbols.has(symbol)) {
      this.symbolToPairMap.set(symbol, pair);
      await this.subscribeToSymbol(symbol);
    }

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

    let isSymbolUsedByOthers = false;
    for (const [id, sub] of this.subscriptions) {
      if (id !== subscriptionId && sub.symbol === subscription.symbol) {
        isSymbolUsedByOthers = true;
        break;
      }
    }

    if (!isSymbolUsedByOthers) {
      this.symbolToPairMap.delete(subscription.symbol);
      await this.unsubscribeFromSymbol(subscription.symbol);
    }
  }

  async unsubscribeAll(): Promise<void> {
    const allSymbols = [...this.subscribedSymbols];
    this.subscriptions.clear();
    this.symbolToPairMap.clear();

    for (const symbol of allSymbols) {
      await this.unsubscribeFromSymbol(symbol);
    }
  }

  async addPair(pair: Pair): Promise<void> {
    const symbol = pairToSymbol(pair);

    if (!this.subscribedSymbols.has(symbol)) {
      this.symbolToPairMap.set(symbol, pair);
      await this.subscribeToSymbol(symbol);
    }
  }

  async removePair(pair: Pair): Promise<void> {
    const symbol = pairToSymbol(pair);

    let isUsedBySubscription = false;
    for (const sub of this.subscriptions.values()) {
      if (sub.symbol === symbol) {
        isUsedBySubscription = true;
        break;
      }
    }

    if (!isUsedBySubscription && this.subscribedSymbols.has(symbol)) {
      this.symbolToPairMap.delete(symbol);
      await this.unsubscribeFromSymbol(symbol);
    }
  }

  onConnectionStateChange(handler: (connected: boolean) => void): void {
    this.eventEmitter.on('connectionStateChange', handler);
  }

  private async establishConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${WS_BASE_URL}?token=${this.apiKey}`;

      this.wsClient = new WebSocketClient({
        url,
        reconnect: this.options.autoReconnect,
        reconnectInterval: this.options.reconnectInterval,
        maxReconnectAttempts: this.options.maxReconnectAttempts,
        pingInterval: 0,
        pongTimeout: 10000,
      });

      this.setupWebSocketHandlers();

      this.wsClient.once('open', () => {
        this.logger.log('WebSocket connection established');
        this.startPing();
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
      this.stopPing();
      this.eventEmitter.emit('connectionStateChange', false);
    });

    this.wsClient.on('reconnect', async () => {
      this.logger.log('WebSocket reconnected, resubscribing to symbols');
      this.startPing();
      this.eventEmitter.emit('connectionStateChange', true);
      try {
        await this.resubscribeAllSymbols();
      } catch (error) {
        this.logger.error('Failed to resubscribe after reconnect', error);
      }
    });
  }

  private async resubscribeAllSymbols(): Promise<void> {
    if (this.subscribedSymbols.size === 0) return;

    const symbols = [...this.subscribedSymbols];
    this.subscribedSymbols.clear();

    for (const symbol of symbols) {
      await this.subscribeToSymbol(symbol);
    }
  }

  private async subscribeToSymbol(symbol: string): Promise<void> {
    if (!this.isConnected) {
      await this.connect();
    }

    if (this.subscribedSymbols.has(symbol)) return;

    const command: FinnhubSubscribeCommand = {
      type: 'subscribe',
      symbol,
    };

    this.wsClient?.send(command);
    this.subscribedSymbols.add(symbol);
    this.logger.debug(`Subscribed to symbol: ${symbol}`);
  }

  private async unsubscribeFromSymbol(symbol: string): Promise<void> {
    if (!this.isConnected || !this.subscribedSymbols.has(symbol)) {
      this.subscribedSymbols.delete(symbol);
      return;
    }

    const command: FinnhubSubscribeCommand = {
      type: 'unsubscribe',
      symbol,
    };

    this.wsClient?.send(command);
    this.subscribedSymbols.delete(symbol);
    this.logger.debug(`Unsubscribed from symbol: ${symbol}`);
  }

  private handleMessage(data: unknown): void {
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
    const pair = this.symbolToPairMap.get(trade.s);

    if (!pair) {
      return;
    }

    const quote: Quote = {
      pair,
      price: String(trade.p),
      receivedAt: new Date(trade.t),
    };

    this.subscriptions.forEach((sub) => {
      if (sub.symbol === trade.s) {
        sub.onQuote(quote);
      }
    });
  }

  private handlePing(): void {
    const pongCommand = { type: 'pong' };
    this.wsClient?.send(pongCommand);
    this.logger.debug('Sent pong response');
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
