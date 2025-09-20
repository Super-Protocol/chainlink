import { SourceName } from '../../sources';
import { Pair } from '../../sources/source-adapter.interface';

export interface CachedQuote {
  source: SourceName;
  pair: Pair;
  price: string;
  receivedAt: Date;
  cachedAt: Date;
}

export interface SerializedCachedQuote
  extends Omit<CachedQuote, 'receivedAt' | 'cachedAt'> {
  receivedAt: number;
  cachedAt: number;
}
