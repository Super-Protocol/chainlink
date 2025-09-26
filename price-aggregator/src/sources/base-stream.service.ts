import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';

import { Logger } from '@nestjs/common';

import { WebSocketClient, WebSocketClientBuilder } from '../common';
import {
  ErrorHandler,
  QuoteHandler,
  QuoteStreamService,
  StreamServiceOptions,
  StreamSubscription,
} from './quote-stream.interface';
import { Pair, Quote } from './source-adapter.interface';
import { SourceName } from './source-name.enum';
import { UseProxyConfig } from '../common/proxy';
import { MetricsService } from '../metrics/metrics.service';

interface Subscription {
  id: string;
  pair: Pair;
  identifier: string;
  onQuote: QuoteHandler;
  onError?: ErrorHandler;
}

export abstract class BaseStreamService implements QuoteStreamService {
  protected abstract readonly logger: Logger;
  protected readonly eventEmitter = new EventEmitter();
  protected wsClient: WebSocketClient | null = null;
  protected readonly subscriptions = new Map<string, Subscription>();
  protected readonly subscribedIdentifiers = new Set<string>();
  protected readonly identifierToPairMap = new Map<string, Pair>();
  private readonly lastUpdateTimes = new Map<string, number>();
  private connectionPromise: Promise<void> | null = null;
  protected readonly options: StreamServiceOptions & {
    autoReconnect: boolean;
    reconnectInterval: number;
    maxReconnectAttempts: number;
    heartbeatInterval: number;
    useProxy: UseProxyConfig;
  };

  constructor(
    protected readonly wsClientBuilder: WebSocketClientBuilder,
    options?: StreamServiceOptions,
    protected readonly metricsService?: MetricsService,
  ) {
    this.options = {
      autoReconnect: options?.autoReconnect ?? true,
      reconnectInterval: options?.reconnectInterval ?? 5000,
      maxReconnectAttempts: options?.maxReconnectAttempts ?? 10,
      heartbeatInterval: options?.heartbeatInterval ?? 30000,
      useProxy: options?.useProxy ?? false,
      rateLimitPerInterval: options?.rateLimitPerInterval,
      rateLimitIntervalMs: options?.rateLimitIntervalMs,
    };
  }

  protected abstract getSourceName(): SourceName;

  get isConnected(): boolean {
    return this.wsClient?.isConnected ?? false;
  }

  get subscribedPairs(): readonly Pair[] {
    return Array.from(this.identifierToPairMap.values());
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
    const identifier = this.pairToIdentifier(pair);

    this.subscriptions.set(subscriptionId, {
      id: subscriptionId,
      pair,
      identifier,
      onQuote,
      onError,
    });

    if (!this.subscribedIdentifiers.has(identifier)) {
      this.identifierToPairMap.set(identifier, pair);
      await this.subscribeToIdentifiers([identifier]);
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

    let isIdentifierUsedByOthers = false;
    for (const sub of this.subscriptions.values()) {
      if (sub.identifier === subscription.identifier) {
        isIdentifierUsedByOthers = true;
        break;
      }
    }

    if (!isIdentifierUsedByOthers) {
      this.identifierToPairMap.delete(subscription.identifier);
      await this.unsubscribeFromIdentifiers([subscription.identifier]);
    }
  }

  async unsubscribeAll(): Promise<void> {
    const allIdentifiers = [...this.subscribedIdentifiers];
    this.subscriptions.clear();
    this.identifierToPairMap.clear();

    if (allIdentifiers.length > 0) {
      await this.unsubscribeFromIdentifiers(allIdentifiers);
    }
  }

  async addPair(pair: Pair): Promise<void> {
    const identifier = this.pairToIdentifier(pair);
    if (!this.subscribedIdentifiers.has(identifier)) {
      this.identifierToPairMap.set(identifier, pair);
      await this.subscribeToIdentifiers([identifier]);
    }
  }

  async removePair(pair: Pair): Promise<void> {
    const identifier = this.pairToIdentifier(pair);

    let isUsedBySubscription = false;
    for (const sub of this.subscriptions.values()) {
      if (sub.identifier === identifier) {
        isUsedBySubscription = true;
        break;
      }
    }

    if (!isUsedBySubscription && this.subscribedIdentifiers.has(identifier)) {
      this.identifierToPairMap.delete(identifier);
      await this.unsubscribeFromIdentifiers([identifier]);
    }
  }

  onConnectionStateChange(handler: (connected: boolean) => void): void {
    this.eventEmitter.on('connectionStateChange', handler);
  }

  protected async establishConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wsClient = this.wsClientBuilder!.build({
        url: this.getWsUrl(),
        useProxy: this.options.useProxy,
        reconnect: this.options.autoReconnect,
        reconnectInterval: this.options.reconnectInterval,
        maxReconnectAttempts: this.options.maxReconnectAttempts,
        pingInterval: this.options.heartbeatInterval,
        pongTimeout: 10000,
        rateLimitPerInterval: this.options.rateLimitPerInterval,
        rateLimitIntervalMs: this.options.rateLimitIntervalMs,
        ...this.getWebSocketClientOptions(),
      });

      this.setupWebSocketHandlers();

      this.wsClient.once('open', () => {
        this.logger.log('WebSocket connection established');
        this.metricsService?.websocketConnections.inc({
          source: this.getSourceName(),
        });
        this.eventEmitter.emit('connectionStateChange', true);
        this.onConnect();
        resolve();
      });

      this.wsClient.once('error', (error: Error) => {
        this.logger.error('WebSocket connection error', error);
        reject(error);
      });

      this.wsClient.connect();
    });
  }

  protected setupWebSocketHandlers(): void {
    if (!this.wsClient) return;

    this.wsClient.on('message', (data: unknown) => {
      this.metricsService?.websocketMessages.inc({
        source: this.getSourceName(),
      });
      this.handleMessage(data);
    });

    this.wsClient.on('error', (error: Error) => {
      this.logger.error('WebSocket error', error);
      this.metricsService?.websocketErrors.inc({
        source: this.getSourceName(),
        error_type: error.name || 'unknown',
      });
      this.subscriptions.forEach((sub) => {
        sub.onError?.(error);
      });
    });

    this.wsClient.on('close', () => {
      this.logger.warn('WebSocket connection closed');
      this.metricsService?.websocketConnections.dec({
        source: this.getSourceName(),
      });
      this.eventEmitter.emit('connectionStateChange', false);
      this.onDisconnect();
    });

    this.wsClient.on('reconnect', async () => {
      this.logger.log('WebSocket reconnected, resubscribing');
      this.metricsService?.websocketReconnects.inc({
        source: this.getSourceName(),
        reason: 'auto_reconnect',
      });
      this.metricsService?.websocketConnections.inc({
        source: this.getSourceName(),
      });
      this.eventEmitter.emit('connectionStateChange', true);
      this.onConnect();
      try {
        await this.resubscribeAll();
      } catch (error) {
        this.logger.error('Failed to resubscribe after reconnect', error);
      }
    });
  }

  protected async resubscribeAll(): Promise<void> {
    if (this.subscribedIdentifiers.size === 0) return;

    const identifiers = [...this.subscribedIdentifiers];

    if (identifiers.length > 0) {
      const successfulIdentifiers = new Set<string>();
      try {
        this.subscribedIdentifiers.clear();
        await this.subscribeToIdentifiers(identifiers);
        identifiers.forEach((i) => successfulIdentifiers.add(i));
      } catch (error) {
        successfulIdentifiers.forEach((i) => this.subscribedIdentifiers.add(i));
        throw error;
      }
    }
  }

  protected async subscribeToIdentifiers(identifiers: string[]): Promise<void> {
    if (!this.isConnected) {
      await this.connect();
    }
    const newIdentifiers = identifiers.filter(
      (i) => !this.subscribedIdentifiers.has(i),
    );
    if (newIdentifiers.length === 0) return;

    await this.sendSubscribeMessage(newIdentifiers);

    newIdentifiers.forEach((i) => this.subscribedIdentifiers.add(i));
  }

  protected async unsubscribeFromIdentifiers(
    identifiers: string[],
  ): Promise<void> {
    if (identifiers.length === 0) return;
    if (!this.isConnected) {
      identifiers.forEach((i) => this.subscribedIdentifiers.delete(i));
      return;
    }

    await this.sendUnsubscribeMessage(identifiers);

    identifiers.forEach((i) => this.subscribedIdentifiers.delete(i));
  }

  protected getWebSocketClientOptions(): Partial<{
    parseJson?: boolean;
    pingInterval?: number;
    pongTimeout?: number;
  }> {
    return {};
  }

  protected onConnect(): void {
    //
  }

  protected onDisconnect(): void {
    //
  }

  protected abstract getWsUrl(): string;
  protected abstract pairToIdentifier(pair: Pair): string;
  protected abstract handleMessage(data: unknown): void;
  protected abstract sendSubscribeMessage(identifiers: string[]): Promise<void>;
  protected abstract sendUnsubscribeMessage(
    identifiers: string[],
  ): Promise<void>;

  protected getPairByIdentifier(identifier: string): Pair | undefined {
    return this.identifierToPairMap.get(identifier);
  }

  protected emitQuote(identifier: string, quote: Omit<Quote, 'pair'>): void {
    const pair = this.getPairByIdentifier(identifier);
    if (!pair) return;

    const fullQuote: Quote = { ...quote, pair };

    if (this.metricsService) {
      const now = Date.now();
      const pairKey = pair.join('-');
      const lastUpdateTime = this.lastUpdateTimes.get(pairKey);

      if (lastUpdateTime) {
        const timeDiff = (now - lastUpdateTime) / 1000;
        this.metricsService.priceUpdateFrequency.observe(
          {
            pair: pairKey,
            source: this.getSourceName(),
          },
          timeDiff,
        );
      }

      this.lastUpdateTimes.set(pairKey, now);
    }

    this.subscriptions.forEach((sub) => {
      if (sub.identifier === identifier) {
        sub.onQuote(fullQuote);
      }
    });
  }
}
