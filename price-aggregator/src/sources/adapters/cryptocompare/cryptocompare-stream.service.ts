import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';

import { Injectable, Logger } from '@nestjs/common';

import { MESSAGE_TYPES } from './cryptocompare.types';
import { WebSocketClient } from '../../../common';
import {
  QuoteHandler,
  ErrorHandler,
  QuoteStreamService,
  StreamSubscription,
  StreamServiceOptions,
} from '../../quote-stream.interface';
import { Pair, Quote } from '../../source-adapter.interface';

const WS_BASE_URL = 'wss://streamer.cryptocompare.com/v2';
const AGGREGATE_INDEX = 'CCCAGG';

interface Subscription {
  id: string;
  pair: Pair;
  channel: string;
  onQuote: QuoteHandler;
  onError?: ErrorHandler;
}

interface SubscriptionMessage {
  action: 'SubAdd' | 'SubRemove';
  subs: string[];
}

@Injectable()
export class CryptoCompareStreamService implements QuoteStreamService {
  private readonly logger = new Logger(CryptoCompareStreamService.name);
  private readonly eventEmitter = new EventEmitter();
  private wsClient: WebSocketClient | null = null;
  private subscriptions = new Map<string, Subscription>();
  private subscribedChannels = new Set<string>();
  private channelToPairMap = new Map<string, Pair>();
  private connectionPromise: Promise<void> | null = null;
  private readonly options: Required<StreamServiceOptions>;
  private readonly apiKey?: string;

  constructor(options?: StreamServiceOptions, apiKey?: string) {
    this.options = {
      autoReconnect: options?.autoReconnect ?? true,
      reconnectInterval: options?.reconnectInterval ?? 5000,
      maxReconnectAttempts: options?.maxReconnectAttempts ?? 10,
      heartbeatInterval: options?.heartbeatInterval ?? 30000,
    };
    this.apiKey = apiKey;
  }

  get isConnected(): boolean {
    return this.wsClient?.isConnected ?? false;
  }

  get subscribedPairs(): readonly Pair[] {
    return Array.from(this.channelToPairMap.values());
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
    const channel = this.pairToChannel(pair);

    this.subscriptions.set(subscriptionId, {
      id: subscriptionId,
      pair,
      channel,
      onQuote,
      onError,
    });

    if (!this.subscribedChannels.has(channel)) {
      this.channelToPairMap.set(channel, pair);
      await this.subscribeToChannels([channel]);
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

    let isChannelUsedByOthers = false;
    for (const [id, sub] of this.subscriptions) {
      if (id !== subscriptionId && sub.channel === subscription.channel) {
        isChannelUsedByOthers = true;
        break;
      }
    }

    if (!isChannelUsedByOthers) {
      this.channelToPairMap.delete(subscription.channel);
      await this.unsubscribeFromChannels([subscription.channel]);
    }
  }

  async unsubscribeAll(): Promise<void> {
    const allChannels = [...this.subscribedChannels];
    this.subscriptions.clear();
    this.channelToPairMap.clear();

    if (allChannels.length > 0) {
      await this.unsubscribeFromChannels(allChannels);
    }
  }

  async addPair(pair: Pair): Promise<void> {
    const channel = this.pairToChannel(pair);

    if (!this.subscribedChannels.has(channel)) {
      this.channelToPairMap.set(channel, pair);
      await this.subscribeToChannels([channel]);
    }
  }

  async removePair(pair: Pair): Promise<void> {
    const channel = this.pairToChannel(pair);

    let isUsedBySubscription = false;
    for (const sub of this.subscriptions.values()) {
      if (sub.channel === channel) {
        isUsedBySubscription = true;
        break;
      }
    }

    if (!isUsedBySubscription && this.subscribedChannels.has(channel)) {
      this.channelToPairMap.delete(channel);
      await this.unsubscribeFromChannels([channel]);
    }
  }

  onConnectionStateChange(handler: (connected: boolean) => void): void {
    this.eventEmitter.on('connectionStateChange', handler);
  }

  private async establishConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = this.apiKey
        ? `${WS_BASE_URL}?api_key=${this.apiKey}&format=streamer`
        : `${WS_BASE_URL}?format=streamer`;

      this.wsClient = new WebSocketClient({
        url,
        reconnect: this.options.autoReconnect,
        reconnectInterval: this.options.reconnectInterval,
        maxReconnectAttempts: this.options.maxReconnectAttempts,
        pingInterval: this.options.heartbeatInterval,
        pongTimeout: 10000,
        parseJson: false,
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

    this.wsClient.on('message', (data: string) => {
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
      this.logger.log('WebSocket reconnected, resubscribing to channels');
      this.eventEmitter.emit('connectionStateChange', true);
      try {
        await this.resubscribeAllChannels();
      } catch (error) {
        this.logger.error('Failed to resubscribe after reconnect', error);
      }
    });
  }

  private async resubscribeAllChannels(): Promise<void> {
    if (this.subscribedChannels.size === 0) return;

    const channels = [...this.subscribedChannels];
    this.subscribedChannels.clear();

    if (channels.length > 0) {
      await this.subscribeToChannels(channels);
    }
  }

  private async subscribeToChannels(channels: string[]): Promise<void> {
    if (!this.isConnected) {
      await this.connect();
    }

    const newChannels = channels.filter((c) => !this.subscribedChannels.has(c));
    if (newChannels.length === 0) return;

    const subscribeMessage: SubscriptionMessage = {
      action: 'SubAdd',
      subs: newChannels,
    };

    if (this.wsClient && this.isConnected) {
      const messageStr = JSON.stringify(subscribeMessage);
      this.logger.debug(`Sending subscription message: ${messageStr}`);
      this.wsClient.send(messageStr);
      newChannels.forEach((c) => this.subscribedChannels.add(c));
      this.logger.debug(`Subscribed to: ${newChannels.join(', ')}`);
    } else {
      this.logger.error('WebSocket not connected');
    }
  }

  private async unsubscribeFromChannels(channels: string[]): Promise<void> {
    if (channels.length === 0) return;
    if (!this.isConnected) {
      channels.forEach((c) => this.subscribedChannels.delete(c));
      return;
    }

    const unsubscribeMessage: SubscriptionMessage = {
      action: 'SubRemove',
      subs: channels,
    };

    if (this.wsClient && this.isConnected) {
      this.wsClient.send(JSON.stringify(unsubscribeMessage));
      this.logger.debug(`Unsubscribed from: ${channels.join(', ')}`);
    }

    channels.forEach((c) => this.subscribedChannels.delete(c));
  }

  private handleMessage(data: string): void {
    try {
      this.logger.debug(`Received message: ${data}`);

      const parts = data.split('~');
      if (parts.length < 2) {
        this.logger.debug(`Ignoring short message: ${data}`);
        return;
      }

      const messageType = parts[0];
      this.logger.debug(`Message type: ${messageType}`);

      if (messageType === MESSAGE_TYPES.CURRENTAGG) {
        this.handleAggregateMessage(parts);
      } else if (messageType === MESSAGE_TYPES.CURRENT) {
        this.handleCurrentMessage(parts);
      } else if (messageType === MESSAGE_TYPES.HEARTBEAT) {
        this.logger.debug('Received heartbeat');
      } else {
        this.logger.debug(
          `Unknown message type: ${messageType}, full message: ${data}`,
        );
      }
    } catch (error) {
      this.logger.error(`Error handling message: ${data}`, error);
    }
  }

  private handleAggregateMessage(parts: string[]): void {
    if (parts.length < 6) return;

    const [, , fromSymbol, toSymbol, , priceStr] = parts;
    const channel = this.buildChannel(fromSymbol, toSymbol);
    const pair = this.channelToPairMap.get(channel);

    if (pair) {
      const price = parseFloat(priceStr);
      if (!isNaN(price)) {
        const quote: Quote = {
          pair,
          price: String(price),
          receivedAt: new Date(),
        };

        this.subscriptions.forEach((sub) => {
          if (sub.channel === channel) {
            sub.onQuote(quote);
          }
        });
      }
    }
  }

  private handleCurrentMessage(parts: string[]): void {
    if (parts.length < 6) return;

    const [, market, fromSymbol, toSymbol, , priceStr] = parts;
    const channel = `2~${market}~${fromSymbol}~${toSymbol}`;
    const pair = this.channelToPairMap.get(channel);

    if (pair) {
      const price = parseFloat(priceStr);
      if (!isNaN(price)) {
        const quote: Quote = {
          pair,
          price: String(price),
          receivedAt: new Date(),
        };

        this.subscriptions.forEach((sub) => {
          if (sub.channel === channel) {
            sub.onQuote(quote);
          }
        });
      }
    }
  }

  private pairToChannel(pair: Pair): string {
    const [base, quote] = pair;
    return this.buildChannel(base.toUpperCase(), quote.toUpperCase());
  }

  private buildChannel(base: string, quote: string): string {
    return `5~${AGGREGATE_INDEX}~${base}~${quote}`;
  }
}
