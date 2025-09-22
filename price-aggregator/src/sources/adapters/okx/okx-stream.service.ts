import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';

import { Injectable, Logger } from '@nestjs/common';

import { OkxWebSocketMessage, OkxSubscribeRequest } from './okx.types';
import { WebSocketClient } from '../../../common';
import {
  QuoteHandler,
  ErrorHandler,
  QuoteStreamService,
  StreamSubscription,
  StreamServiceOptions,
} from '../../quote-stream.interface';
import { Pair, Quote } from '../../source-adapter.interface';

const WS_BASE_URL = 'wss://ws.okx.com:8443';
const WS_PUBLIC_PATH = '/ws/v5/public';
const SUBSCRIBE_OP = 'subscribe';
const UNSUBSCRIBE_OP = 'unsubscribe';
const TICKERS_CHANNEL = 'tickers';

interface Subscription {
  id: string;
  pair: Pair;
  instId: string;
  onQuote: QuoteHandler;
  onError?: ErrorHandler;
}

@Injectable()
export class OkxStreamService implements QuoteStreamService {
  private readonly logger = new Logger(OkxStreamService.name);
  private readonly eventEmitter = new EventEmitter();
  private wsClient: WebSocketClient | null = null;
  private subscriptions = new Map<string, Subscription>();
  private subscribedInstruments = new Set<string>();
  private instIdToPairMap = new Map<string, Pair>();
  private reconnecting = false;
  private connectionPromise: Promise<void> | null = null;
  private readonly options: Required<StreamServiceOptions>;
  private pendingCommands = new Map<
    string,
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
      heartbeatInterval: options?.heartbeatInterval ?? 25000,
    };
  }

  get isConnected(): boolean {
    return this.wsClient?.isConnected ?? false;
  }

  get subscribedPairs(): readonly Pair[] {
    return Array.from(this.instIdToPairMap.values());
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
    const instId = this.pairToInstId(pair);

    this.subscriptions.set(subscriptionId, {
      id: subscriptionId,
      pair,
      instId,
      onQuote,
      onError,
    });

    if (!this.subscribedInstruments.has(instId)) {
      this.instIdToPairMap.set(instId, pair);
      await this.subscribeToInstruments([instId]);
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

    let isInstrumentUsedByOthers = false;
    for (const [id, sub] of this.subscriptions) {
      if (id !== subscriptionId && sub.instId === subscription.instId) {
        isInstrumentUsedByOthers = true;
        break;
      }
    }

    if (!isInstrumentUsedByOthers) {
      this.instIdToPairMap.delete(subscription.instId);
      await this.unsubscribeFromInstruments([subscription.instId]);
    }
  }

  async unsubscribeAll(): Promise<void> {
    const allInstruments = [...this.subscribedInstruments];
    this.subscriptions.clear();
    this.instIdToPairMap.clear();

    if (allInstruments.length > 0) {
      await this.unsubscribeFromInstruments(allInstruments);
    }
  }

  async addPair(pair: Pair): Promise<void> {
    const instId = this.pairToInstId(pair);

    if (!this.subscribedInstruments.has(instId)) {
      this.instIdToPairMap.set(instId, pair);
      await this.subscribeToInstruments([instId]);
    }
  }

  async removePair(pair: Pair): Promise<void> {
    const instId = this.pairToInstId(pair);

    let isUsedBySubscription = false;
    for (const sub of this.subscriptions.values()) {
      if (sub.instId === instId) {
        isUsedBySubscription = true;
        break;
      }
    }

    if (!isUsedBySubscription && this.subscribedInstruments.has(instId)) {
      this.instIdToPairMap.delete(instId);
      await this.unsubscribeFromInstruments([instId]);
    }
  }

  onConnectionStateChange(handler: (connected: boolean) => void): void {
    this.eventEmitter.on('connectionStateChange', handler);
  }

  private async establishConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${WS_BASE_URL}${WS_PUBLIC_PATH}`;

      this.wsClient = new WebSocketClient({
        url,
        reconnect: this.options.autoReconnect,
        reconnectInterval: this.options.reconnectInterval,
        maxReconnectAttempts: this.options.maxReconnectAttempts,
        pingInterval: this.options.heartbeatInterval,
        pongTimeout: 30000,
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
      this.logger.log('WebSocket reconnected, resubscribing to instruments');
      try {
        await this.resubscribeAllInstruments();
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

  private async resubscribeAllInstruments(): Promise<void> {
    if (this.subscribedInstruments.size === 0) return;

    const instruments = [...this.subscribedInstruments];
    this.subscribedInstruments.clear();

    if (instruments.length > 0) {
      await this.subscribeToInstruments(instruments);
    }
  }

  private async subscribeToInstruments(instIds: string[]): Promise<void> {
    if (!this.isConnected) {
      await this.connect();
    }

    const newInstruments = instIds.filter(
      (id) => !this.subscribedInstruments.has(id),
    );
    if (newInstruments.length === 0) return;

    const commandId = randomUUID();
    const command: OkxSubscribeRequest = {
      op: SUBSCRIBE_OP,
      args: newInstruments.map((instId) => ({
        channel: TICKERS_CHANNEL,
        instId,
      })),
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(commandId);
        this.logger.warn(
          `Subscribe timeout for instruments: ${newInstruments.join(', ')}`,
        );
        newInstruments.forEach((id) => this.subscribedInstruments.add(id));
        resolve();
      }, 10000);

      this.pendingCommands.set(commandId, {
        resolve: () => {
          clearTimeout(timeout);
          this.pendingCommands.delete(commandId);
          newInstruments.forEach((id) => this.subscribedInstruments.add(id));
          this.logger.debug(`Subscribed to: ${newInstruments.join(', ')}`);
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

  private async unsubscribeFromInstruments(instIds: string[]): Promise<void> {
    if (instIds.length === 0) return;
    if (!this.isConnected) {
      instIds.forEach((id) => this.subscribedInstruments.delete(id));
      return;
    }

    const commandId = randomUUID();
    const command: OkxSubscribeRequest = {
      op: UNSUBSCRIBE_OP,
      args: instIds.map((instId) => ({
        channel: TICKERS_CHANNEL,
        instId,
      })),
    };

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(commandId);
        instIds.forEach((id) => this.subscribedInstruments.delete(id));
        resolve();
      }, 5000);

      this.pendingCommands.set(commandId, {
        resolve: () => {
          clearTimeout(timeout);
          this.pendingCommands.delete(commandId);
          instIds.forEach((id) => this.subscribedInstruments.delete(id));
          resolve();
        },
        reject: () => {
          clearTimeout(timeout);
          this.pendingCommands.delete(commandId);
          resolve();
        },
        timeout,
      });

      this.wsClient?.send(command);
    });
  }

  private handleMessage(data: unknown): void {
    try {
      const message = data as OkxWebSocketMessage;

      if (message.event === 'subscribe') {
        const commandId = Object.keys(
          Object.fromEntries(this.pendingCommands),
        )[0];
        const pending = commandId
          ? this.pendingCommands.get(commandId)
          : undefined;
        if (pending) {
          if (message.code === '0') {
            pending.resolve();
          } else {
            pending.reject(new Error(message.msg || 'Subscribe failed'));
          }
        }
        return;
      }

      if (message.event === 'unsubscribe') {
        const commandId = Object.keys(
          Object.fromEntries(this.pendingCommands),
        )[0];
        const pending = commandId
          ? this.pendingCommands.get(commandId)
          : undefined;
        if (pending) {
          if (message.code === '0') {
            pending.resolve();
          } else {
            pending.reject(new Error(message.msg || 'Unsubscribe failed'));
          }
        }
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
            const pair = this.instIdToPairMap.get(tickerData.instId);
            if (pair) {
              const quote: Quote = {
                pair,
                price: String(tickerData.last),
                receivedAt: new Date(parseInt(tickerData.ts, 10)),
              };

              this.subscriptions.forEach((sub) => {
                if (sub.instId === tickerData.instId) {
                  sub.onQuote(quote);
                }
              });
            }
          }
        }
      }
    } catch (error) {
      this.logger.error('Error handling message', error);
    }
  }

  private pairToInstId(pair: Pair): string {
    return `${pair[0].toUpperCase()}-${pair[1].toUpperCase()}`;
  }
}
