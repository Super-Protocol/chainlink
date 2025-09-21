import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';

import { Injectable, Logger } from '@nestjs/common';

import { BinanceTickerData } from './binance.types';
import { WebSocketClient } from '../../../common';
import {
  QuoteHandler,
  ErrorHandler,
  QuoteStreamService,
  StreamSubscription,
  StreamServiceOptions,
} from '../../quote-stream.interface';
import { Pair, Quote } from '../../source-adapter.interface';

const WS_BASE_URL = 'wss://stream.binance.com:9443';
const SUBSCRIBE_METHOD = 'SUBSCRIBE';
const UNSUBSCRIBE_METHOD = 'UNSUBSCRIBE';

interface Subscription {
  id: string;
  pair: Pair;
  stream: string;
  onQuote: QuoteHandler;
  onError?: ErrorHandler;
}

interface WebSocketCommand {
  method: string;
  params: string[];
  id: number;
}

@Injectable()
export class BinanceStreamService implements QuoteStreamService {
  private readonly logger = new Logger(BinanceStreamService.name);
  private readonly eventEmitter = new EventEmitter();
  private wsClient: WebSocketClient | null = null;
  private subscriptions = new Map<string, Subscription>();
  private subscribedStreams = new Set<string>();
  private streamToPairMap = new Map<string, Pair>();
  private commandId = 1;
  private reconnecting = false;
  private connectionPromise: Promise<void> | null = null;
  private readonly options: Required<StreamServiceOptions>;
  private pendingCommands = new Map<
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
      heartbeatInterval: options?.heartbeatInterval ?? 5000,
    };
  }

  get isConnected(): boolean {
    return this.wsClient?.isConnected ?? false;
  }

  get subscribedPairs(): readonly Pair[] {
    return Array.from(this.streamToPairMap.values());
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
    this.reconnecting = false;

    // Отменяем все ожидающие команды
    this.pendingCommands.forEach((pending) => {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Disconnected'));
    });
    this.pendingCommands.clear();

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
    const stream = this.pairToStream(pair);

    this.subscriptions.set(subscriptionId, {
      id: subscriptionId,
      pair,
      stream,
      onQuote,
      onError,
    });

    if (!this.subscribedStreams.has(stream)) {
      this.streamToPairMap.set(stream, pair);
      await this.subscribeToStreams([stream]);
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

    let isStreamUsedByOthers = false;
    for (const [id, sub] of this.subscriptions) {
      if (id !== subscriptionId && sub.stream === subscription.stream) {
        isStreamUsedByOthers = true;
        break;
      }
    }

    if (!isStreamUsedByOthers) {
      this.streamToPairMap.delete(subscription.stream);
      await this.unsubscribeFromStreams([subscription.stream]);
    }
  }

  async unsubscribeAll(): Promise<void> {
    const allStreams = [...this.subscribedStreams];
    this.subscriptions.clear();
    this.streamToPairMap.clear();

    if (allStreams.length > 0) {
      await this.unsubscribeFromStreams(allStreams);
    }
  }

  async addPair(pair: Pair): Promise<void> {
    const stream = this.pairToStream(pair);

    if (!this.subscribedStreams.has(stream)) {
      this.streamToPairMap.set(stream, pair);
      await this.subscribeToStreams([stream]);
    }
  }

  async removePair(pair: Pair): Promise<void> {
    const stream = this.pairToStream(pair);

    let isUsedBySubscription = false;
    for (const sub of this.subscriptions.values()) {
      if (sub.stream === stream) {
        isUsedBySubscription = true;
        break;
      }
    }

    if (!isUsedBySubscription && this.subscribedStreams.has(stream)) {
      this.streamToPairMap.delete(stream);
      await this.unsubscribeFromStreams([stream]);
    }
  }

  onConnectionStateChange(handler: (connected: boolean) => void): void {
    this.eventEmitter.on('connectionStateChange', handler);
  }

  private async establishConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${WS_BASE_URL}/ws`;

      this.wsClient = new WebSocketClient({
        url,
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

      // Отменяем все ожидающие команды
      this.pendingCommands.forEach((pending) => {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Connection closed'));
      });
      this.pendingCommands.clear();

      if (this.options.autoReconnect && !this.reconnecting) {
        this.handleReconnection();
      }
    });

    this.wsClient.on('reconnect', async () => {
      this.logger.log('WebSocket reconnected, resubscribing to streams');
      try {
        await this.resubscribeAllStreams();
      } catch (error) {
        this.logger.error('Failed to resubscribe after reconnect', error);
      }
    });
  }

  private async handleReconnection(): Promise<void> {
    if (this.reconnecting) return;

    this.reconnecting = true;
    this.logger.log('Attempting to reconnect...');

    try {
      await this.connect();
      this.reconnecting = false;
    } catch (error) {
      this.logger.error('Reconnection failed', error);
      this.reconnecting = false;
      this.subscriptions.forEach((sub) => {
        sub.onError?.(new Error('Reconnection failed'));
      });
    }
  }

  private async resubscribeAllStreams(): Promise<void> {
    if (this.subscribedStreams.size === 0) return;

    const streams = [...this.subscribedStreams];
    this.subscribedStreams.clear();

    if (streams.length > 0) {
      await this.subscribeToStreams(streams);
    }
  }

  private async subscribeToStreams(streams: string[]): Promise<void> {
    if (!this.isConnected) {
      await this.connect();
    }

    const newStreams = streams.filter((s) => !this.subscribedStreams.has(s));
    if (newStreams.length === 0) return;

    const commandId = this.commandId++;
    const command: WebSocketCommand = {
      method: SUBSCRIBE_METHOD,
      params: newStreams,
      id: commandId,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(commandId);
        this.logger.warn(
          `Subscribe timeout for streams: ${newStreams.join(', ')}`,
        );
        // Оптимистично добавляем стримы при таймауте
        newStreams.forEach((s) => this.subscribedStreams.add(s));
        resolve();
      }, 10000);

      this.pendingCommands.set(commandId, {
        resolve: () => {
          clearTimeout(timeout);
          this.pendingCommands.delete(commandId);
          newStreams.forEach((s) => this.subscribedStreams.add(s));
          this.logger.debug(`Subscribed to: ${newStreams.join(', ')}`);
          resolve();
        },
        reject: (error: Error) => {
          clearTimeout(timeout);
          this.pendingCommands.delete(commandId);
          reject(error);
        },
        timeout,
      });

      this.wsClient?.send(command);
    });
  }

  private async unsubscribeFromStreams(streams: string[]): Promise<void> {
    if (!this.isConnected || streams.length === 0) return;

    const commandId = this.commandId++;
    const command: WebSocketCommand = {
      method: UNSUBSCRIBE_METHOD,
      params: streams,
      id: commandId,
    };

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(commandId);
        streams.forEach((s) => this.subscribedStreams.delete(s));
        resolve();
      }, 5000);

      this.pendingCommands.set(commandId, {
        resolve: () => {
          clearTimeout(timeout);
          this.pendingCommands.delete(commandId);
          streams.forEach((s) => this.subscribedStreams.delete(s));
          resolve();
        },
        reject: () => {
          clearTimeout(timeout);
          this.pendingCommands.delete(commandId);
          resolve(); // Не отклоняем при ошибке отписки
        },
        timeout,
      });

      this.wsClient?.send(command);
    });
  }

  private handleMessage(data: unknown): void {
    try {
      const message = data as Record<string, unknown>;

      // Обрабатываем ответы на команды
      if ('id' in message && typeof message.id === 'number') {
        const pending = this.pendingCommands.get(message.id);
        if (pending) {
          if (message.result === null || message.result === undefined) {
            pending.resolve();
          } else if (message.error) {
            pending.reject(new Error(String(message.error)));
          } else {
            pending.resolve();
          }
        }
        return;
      }

      if (
        message.stream &&
        message.data &&
        typeof message.stream === 'string'
      ) {
        const tickerData = message.data as BinanceTickerData;
        const pair = this.streamToPairMap.get(message.stream);
        if (pair && typeof tickerData.c === 'string') {
          const quote: Quote = {
            pair,
            price: String(tickerData.c),
            receivedAt: new Date(
              typeof tickerData.E === 'number' ? tickerData.E : Date.now(),
            ),
          };

          this.subscriptions.forEach((sub) => {
            if (sub.stream === message.stream) {
              sub.onQuote(quote);
            }
          });
        }
      } else if (
        message.e === '24hrMiniTicker' &&
        typeof message.s === 'string' &&
        typeof message.c === 'string'
      ) {
        const stream = `${message.s.toLowerCase()}@miniTicker`;
        const pair = this.streamToPairMap.get(stream);

        if (pair) {
          const quote: Quote = {
            pair,
            price: String(message.c),
            receivedAt: new Date(
              typeof message.E === 'number' ? message.E : Date.now(),
            ),
          };

          this.subscriptions.forEach((sub) => {
            if (sub.stream === stream) {
              sub.onQuote(quote);
            }
          });
        }
      }
    } catch (error) {
      this.logger.error('Error handling message', error);
    }
  }

  private pairToStream(pair: Pair): string {
    return `${pair.join('').toLowerCase()}@miniTicker`;
  }
}
