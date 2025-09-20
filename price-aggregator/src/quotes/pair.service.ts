import { Injectable, Logger } from '@nestjs/common';

import { SourceName } from '../sources';
import { Pair } from '../sources/source-adapter.interface';

interface PairSourceRegistration {
  pair: Pair;
  source: SourceName;
  registeredAt: number;
  lastQuoteAt: number;
  lastRequestAt: number;
}

@Injectable()
export class PairService {
  private readonly logger = new Logger(PairService.name);
  private readonly registrations = new Map<string, PairSourceRegistration>();

  trackQuoteRequest(pair: Pair, source: SourceName): void {
    const key = this.getPairSourceKey(pair, source);
    const now = Date.now();

    const existing = this.registrations.get(key);

    if (existing) {
      existing.lastRequestAt = now;
      this.logger.debug(
        `Updated request time for pair ${pair.join('/')} from source ${source}`,
      );
    } else {
      this.registrations.set(key, {
        pair,
        source,
        registeredAt: now,
        lastQuoteAt: 0, // Will be updated when quote is successful
        lastRequestAt: now,
      });
      this.logger.debug(
        `Started tracking pair ${pair.join('/')} for source ${source}`,
      );
    }
  }

  trackSuccessfulQuote(pair: Pair, source: SourceName): void {
    const key = this.getPairSourceKey(pair, source);
    const now = Date.now();

    const existing = this.registrations.get(key);

    if (existing) {
      existing.lastQuoteAt = now;
      this.logger.debug(
        `Updated quote time for pair ${pair.join('/')} from source ${source}`,
      );
    } else {
      // This shouldn't happen if trackQuoteRequest was called first
      this.registrations.set(key, {
        pair,
        source,
        registeredAt: now,
        lastQuoteAt: now,
        lastRequestAt: now,
      });
      this.logger.debug(
        `Registered new pair ${pair.join('/')} for source ${source}`,
      );
    }
  }

  getPairsBySource(source: SourceName): Pair[] {
    const pairs: Pair[] = [];

    for (const registration of this.registrations.values()) {
      if (registration.source === source) {
        pairs.push(registration.pair);
      }
    }

    return pairs;
  }

  getSourcesByPair(pair: Pair): string[] {
    const sources: string[] = [];
    const pairKey = pair.join('/');

    for (const registration of this.registrations.values()) {
      if (registration.pair.join('/') === pairKey) {
        sources.push(registration.source);
      }
    }

    return sources;
  }

  getAllRegistrations(): PairSourceRegistration[] {
    return Array.from(this.registrations.values());
  }

  removePairSource(pair: Pair, source: string): void {
    const key = this.getPairSourceKey(pair, source);
    const removed = this.registrations.delete(key);

    if (removed) {
      this.logger.debug(`Removed pair ${pair.join('/')} for source ${source}`);
    }
  }

  private getPairSourceKey(pair: Pair, source: string): string {
    return `${pair.join('/')}:${source}`;
  }
}
