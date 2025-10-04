import { SourceName } from '../../sources';
import { Pair } from '../../sources/source-adapter.interface';

export interface StaleItem {
  source: SourceName;
  pair: Pair;
  expiresAt: Date;
}

export interface StaleBatch {
  items: StaleItem[];
  timestamp: Date;
}

export interface CacheMetadata {
  source: SourceName;
  pair: Pair;
  cachedAt: Date;
  expiresAt: Date;
  ttl: number;
  staleTriggerBeforeExpiry: number;
  lastRefreshed?: Date;
}

export interface StalenessConfig {
  staleTriggerBeforeExpiry: number; // milliseconds before expiry to trigger stale event
  batchInterval: number; // milliseconds to wait for batching multiple stale items
  minTimeBetweenRefreshes: number; // minimum milliseconds between refreshes for same item
}
