import { SourceName } from '../sources';
import { Pair } from '../sources/source-adapter.interface';

export interface RetryMetadata {
  source: SourceName;
  pair: Pair;
  attempt: number;
  lastAttemptAt: Date;
  nextRetryAt: Date;
  firstFailedAt: Date;
}

export interface FailedPairsRetryConfig {
  enabled: boolean;
  maxAttempts: number;
  retryDelay: number;
  checkInterval: number;
}
