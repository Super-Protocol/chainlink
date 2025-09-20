import { Pair, Quote } from './source-adapter.interface';

export type QuoteHandler = (quote: Quote) => void;
export type ErrorHandler = (error: Error) => void;

export interface StreamSubscription {
  readonly id: string;
  readonly pair: Pair;
  unsubscribe(): Promise<void>;
}

export interface QuoteStreamService {
  readonly isConnected: boolean;
  readonly subscribedPairs: readonly Pair[];

  subscribe(
    pair: Pair,
    onQuote: QuoteHandler,
    onError?: ErrorHandler,
  ): Promise<StreamSubscription>;
  unsubscribe(subscriptionId: string): Promise<void>;
  unsubscribeAll(): Promise<void>;
  addPair(pair: Pair): Promise<void>;
  removePair(pair: Pair): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onConnectionStateChange(handler: (connected: boolean) => void): void;
}

export interface StreamServiceOptions {
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  heartbeatInterval?: number;
}
