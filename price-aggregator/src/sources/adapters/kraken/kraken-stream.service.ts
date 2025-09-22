import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';

import { Injectable, Logger } from '@nestjs/common';

import {
  KrakenTickerData,
  KrakenWebSocketMessage,
  KrakenSubscribeRequest,
  KrakenUnsubscribeRequest,
  KrakenSubscribeResponse,
} from './kraken.types';
import { WebSocketClient } from '../../../common';
import {
  QuoteHandler,
  ErrorHandler,
  QuoteStreamService,
  StreamSubscription,
  StreamServiceOptions,
} from '../../quote-stream.interface';
import { Pair, Quote } from '../../source-adapter.interface';

const WS_BASE_URL = 'wss://ws.kraken.com/v2';

interface Subscription {
  id: string;
  pair: Pair;
  symbol: string;
  onQuote: QuoteHandler;
  onError?: ErrorHandler;
}

@Injectable()
export class KrakenStreamService implements QuoteStreamService {
  private readonly logger = new Logger(KrakenStreamService.name);
  private readonly eventEmitter = new EventEmitter();
  private wsClient: WebSocketClient | null = null;
  private subscriptions = new Map<string, Subscription>();
  private subscribedSymbols = new Set<string>();
  private symbolToPairMap = new Map<string, Pair>();
  private requestId = 1;
  private connectionPromise: Promise<void> | null = null;
  private readonly options: Required<StreamServiceOptions>;
  private pendingRequests = new Map<
    number,
    {
      resolve: () => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  constructor(options?: StreamServiceOptions) {
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
    this.pendingRequests.forEach((pending) => {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Disconnected'));
    });
    this.pendingRequests.clear();

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
    const symbol = this.pairToSymbol(pair);

    this.subscriptions.set(subscriptionId, {
      id: subscriptionId,
      pair,
      symbol,
      onQuote,
      onError,
    });

    if (!this.subscribedSymbols.has(symbol)) {
      this.symbolToPairMap.set(symbol, pair);
      await this.subscribeToSymbols([symbol]);
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
      await this.unsubscribeFromSymbols([subscription.symbol]);
    }
  }

  async unsubscribeAll(): Promise<void> {
    const allSymbols = [...this.subscribedSymbols];
    this.subscriptions.clear();
    this.symbolToPairMap.clear();

    if (allSymbols.length > 0) {
      await this.unsubscribeFromSymbols(allSymbols);
    }
  }

  async addPair(pair: Pair): Promise<void> {
    const symbol = this.pairToSymbol(pair);

    if (!this.subscribedSymbols.has(symbol)) {
      this.symbolToPairMap.set(symbol, pair);
      await this.subscribeToSymbols([symbol]);
    }
  }

  async removePair(pair: Pair): Promise<void> {
    const symbol = this.pairToSymbol(pair);

    let isUsedBySubscription = false;
    for (const sub of this.subscriptions.values()) {
      if (sub.symbol === symbol) {
        isUsedBySubscription = true;
        break;
      }
    }

    if (!isUsedBySubscription && this.subscribedSymbols.has(symbol)) {
      this.symbolToPairMap.delete(symbol);
      await this.unsubscribeFromSymbols([symbol]);
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

      this.pendingRequests.forEach((pending) => {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Connection closed'));
      });
      this.pendingRequests.clear();
    });

    this.wsClient.on('reconnect', async () => {
      this.logger.log('WebSocket reconnected, resubscribing to symbols');
      this.eventEmitter.emit('connectionStateChange', true);
      try {
        await this.resubscribeAllSymbols();
      } catch (error) {
        this.logger.error('Failed to resubscribe after reconnect', error);
      }
    });
  }

  private async resubscribeAllSymbols(): Promise<void> {
    if (this.subscribedSymbols.size === 0) {
      this.logger.verbose('No symbols to resubscribe');
      return;
    }

    const symbols = [...this.subscribedSymbols];
    this.logger.verbose(
      `Resubscribing to ${symbols.length} symbols: ${symbols.join(', ')}`,
    );

    // Clear subscribedSymbols to force resubscription after reconnect
    this.subscribedSymbols.clear();
    this.logger.verbose('Cleared subscribedSymbols for resubscription');

    if (symbols.length > 0) {
      try {
        await this.subscribeToSymbols(symbols);
        this.logger.verbose('Resubscription completed successfully');
      } catch (error) {
        this.logger.error('Resubscription failed', error);
      }
    }
  }

  private async subscribeToSymbols(symbols: string[]): Promise<void> {
    if (!this.isConnected) {
      this.logger.verbose('Not connected, establishing connection...');
      await this.connect();
    }

    this.logger.verbose(`Requested symbols: ${symbols.join(', ')}`);
    this.logger.verbose(
      `Currently subscribed symbols: ${Array.from(this.subscribedSymbols).join(', ')}`,
    );

    const newSymbols = symbols.filter((s) => !this.subscribedSymbols.has(s));
    this.logger.verbose(`New symbols to subscribe: ${newSymbols.join(', ')}`);

    if (newSymbols.length === 0) {
      this.logger.verbose('No new symbols to subscribe to');
      return;
    }

    const requestId = this.requestId++;
    const request: KrakenSubscribeRequest = {
      method: 'subscribe',
      params: {
        channel: 'ticker',
        symbol: newSymbols,
        event_trigger: 'trades',
        snapshot: true,
      },
      req_id: requestId,
    };

    this.logger.debug(
      `Sending subscription request: ${JSON.stringify(request)}`,
    );

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        this.logger.warn(
          `Subscribe timeout for symbols: ${newSymbols.join(', ')}, req_id: ${requestId}`,
        );
        newSymbols.forEach((s) => this.subscribedSymbols.add(s));
        resolve();
      }, 10000);

      this.pendingRequests.set(requestId, {
        resolve: () => {
          clearTimeout(timeout);
          this.pendingRequests.delete(requestId);
          newSymbols.forEach((s) => this.subscribedSymbols.add(s));
          this.logger.debug(
            `Successfully subscribed to: ${newSymbols.join(', ')}`,
          );
          resolve();
        },
        reject: (error: Error) => {
          clearTimeout(timeout);
          this.pendingRequests.delete(requestId);
          this.logger.error(`Subscription rejected: ${error.message}`);
          reject(error);
        },
        timeout,
      });

      this.logger.debug(`Added pending request with req_id: ${requestId}`);
      this.wsClient?.send(request);
    });
  }

  private async unsubscribeFromSymbols(symbols: string[]): Promise<void> {
    if (symbols.length === 0) return;
    if (!this.isConnected) {
      symbols.forEach((s) => this.subscribedSymbols.delete(s));
      return;
    }

    const requestId = this.requestId++;
    const request: KrakenUnsubscribeRequest = {
      method: 'unsubscribe',
      params: {
        channel: 'ticker',
        symbol: symbols,
        event_trigger: 'trades',
      },
      req_id: requestId,
    };

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        symbols.forEach((s) => this.subscribedSymbols.delete(s));
        resolve();
      }, 5000);

      this.pendingRequests.set(requestId, {
        resolve: () => {
          clearTimeout(timeout);
          this.pendingRequests.delete(requestId);
          symbols.forEach((s) => this.subscribedSymbols.delete(s));
          resolve();
        },
        reject: () => {
          clearTimeout(timeout);
          this.pendingRequests.delete(requestId);
          resolve();
        },
        timeout,
      });

      this.wsClient?.send(request);
    });
  }

  private handleMessage(data: unknown): void {
    try {
      const message = data as Record<string, unknown>;

      // Skip logging heartbeat messages to reduce noise
      if (message.channel !== 'heartbeat') {
        this.logger.verbose(
          `Received WebSocket message: ${JSON.stringify(data)}`,
        );
      }

      if (
        message.method &&
        message.req_id &&
        typeof message.req_id === 'number'
      ) {
        this.logger.verbose(
          `Processing response for req_id: ${message.req_id}`,
        );
        const pending = this.pendingRequests.get(message.req_id);
        if (pending) {
          const response = message as unknown as KrakenSubscribeResponse;
          this.logger.verbose(
            `Response details: success=${response.success}, error=${response.error}`,
          );
          if (response.success) {
            this.logger.verbose(
              `Subscription successful for req_id: ${message.req_id}`,
            );
            pending.resolve();
          } else {
            this.logger.error(
              `Subscription failed for req_id: ${message.req_id}, error: ${response.error}`,
            );
            // Handle "Already subscribed" as success since the subscription exists
            if (response.error === 'Already subscribed') {
              this.logger.verbose('Treating "Already subscribed" as success');
              pending.resolve();
            } else {
              pending.reject(new Error(response.error || 'Unknown error'));
            }
          }
        } else {
          this.logger.warn(
            `No pending request found for req_id: ${message.req_id}`,
          );
        }
        return;
      }

      if (message.channel === 'ticker' && Array.isArray(message.data)) {
        this.logger.verbose(
          `Processing ticker data: ${message.data.length} items`,
        );
        const tickerMessage = message as KrakenWebSocketMessage;
        tickerMessage.data?.forEach((tickerData, index) => {
          this.logger.verbose(
            `Processing ticker item ${index}: symbol=${tickerData.symbol}, last=${tickerData.last}`,
          );
          this.processTickerData(tickerData);
        });
      } else if (message.channel !== 'heartbeat') {
        // Only log non-heartbeat unhandled messages
        this.logger.verbose(
          `Unhandled message type: channel=${message.channel}, data type=${typeof message.data}`,
        );
      }
    } catch (error) {
      this.logger.error('Error handling message', error);
      this.logger.error(`Raw message data: ${JSON.stringify(data)}`);
    }
  }

  private processTickerData(tickerData: KrakenTickerData): void {
    this.logger.verbose(
      `Processing ticker data for symbol: ${tickerData.symbol}`,
    );
    const pair = this.symbolToPairMap.get(tickerData.symbol);
    if (!pair) {
      this.logger.warn(
        `No pair mapping found for symbol: ${tickerData.symbol}`,
      );
      this.logger.verbose(
        `Available symbol mappings: ${JSON.stringify(Array.from(this.symbolToPairMap.entries()))}`,
      );
      return;
    }

    const quote: Quote = {
      pair,
      price: String(tickerData.last),
      receivedAt: new Date(),
    };

    this.logger.verbose(`Created quote for ${pair.join('/')}: ${quote.price}`);

    let subscriptionCount = 0;
    this.subscriptions.forEach((sub) => {
      if (sub.symbol === tickerData.symbol) {
        subscriptionCount++;
        sub.onQuote(quote);
      }
    });

    this.logger.verbose(`Sent quote to ${subscriptionCount} subscriptions`);
  }

  private pairToSymbol(pair: Pair): string {
    // Kraken WebSocket API v2 expects symbols in format like "BTC/USD"
    // but for some pairs we need to use Kraken's specific naming
    const [base, quote] = pair;

    // Handle special cases for Kraken WebSocket
    const wsBase = base === 'BTC' ? 'BTC' : base;
    const wsQuote = quote === 'USDT' ? 'USDT' : quote;

    const symbol = `${wsBase}/${wsQuote}`;
    this.logger.debug(
      `Converted pair [${pair.join(', ')}] to symbol: ${symbol}`,
    );
    return symbol;
  }
}
