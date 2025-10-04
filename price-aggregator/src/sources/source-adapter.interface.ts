import { QuoteStreamService } from './quote-stream.interface';
import { SourceConfig as SourceAdapterConfig } from '../config/schema/sources.schema';

export type { SourceAdapterConfig };
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
  getConfig(): SourceAdapterConfig;
  fetchQuote(pair: Pair): Promise<Quote>;
  getPairs?(): Promise<Pair[]>;
  fetchQuotes?(pairs: Pair[]): Promise<Quote[]>;
  getStreamService?(): QuoteStreamService;
}
