import { QuoteStreamService } from './quote-stream.interface';

export type Pair = [string, string];

export interface Quote {
  pair: Pair;
  price: string;
  receivedAt: Date;
}

export interface SourceCapabilities {
  supportsBatch: boolean;
  supportsWebSocket: boolean;
  maxBatchSize?: number;
}

export interface SourceConfig {
  name: string;
  enabled: boolean;
  mode?: 'periodic' | 'on-demand' | 'realtime';
  useWebSocket?: boolean;
  pollIntervalMs?: number;
  rateLimitRps?: number;
  timeoutMs?: number;
  ttl?: number;
}

export interface SourceAdapter {
  isEnabled(): boolean;
  getTtl(): number;
  isRefetchEnabled(): boolean;
  getMaxBatchSize?(): number;
  fetchQuote(pair: Pair): Promise<Quote>;
  getPairs?(): Promise<Pair[]>;
  fetchQuotes?(pairs: Pair[]): Promise<Quote[]>;
  getStreamService?(): QuoteStreamService;
}
