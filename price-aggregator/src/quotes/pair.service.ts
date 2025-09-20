import { Injectable, Logger } from '@nestjs/common';

import { SourceName } from '../sources';
import { Pair } from '../sources/source-adapter.interface';

interface PairSourceRegistration {
  pair: Pair;
  source: SourceName;
  registeredAt: Date;
  lastFetchAt: Date;
  lastResponseAt: Date;
  lastRequestAt: Date;
}

@Injectable()
export class PairService {
  private readonly logger = new Logger(PairService.name);
  private readonly registrations = new Map<string, PairSourceRegistration>();
  private readonly pairsBySource = new Map<SourceName, Set<string>>();
  private readonly sourcesByPair = new Map<string, Set<SourceName>>();

  trackQuoteRequest(pair: Pair, source: SourceName): void {
    const key = this.getPairSourceKey(pair, source);
    const now = new Date();

    const existing = this.registrations.get(key);

    if (existing) {
      existing.lastRequestAt = now;
      this.logger.debug(
        `Updated request time for pair ${pair.join('/')} from source ${source}`,
      );
    } else {
      this.createRegistration(pair, source, {
        registeredAt: now,
        lastFetchAt: new Date(0),
        lastResponseAt: new Date(0),
        lastRequestAt: now,
      });
      this.logger.debug(
        `Started tracking pair ${pair.join('/')} for source ${source}`,
      );
    }
  }

  trackSuccessfulFetch(pair: Pair, source: SourceName): void {
    const key = this.getPairSourceKey(pair, source);
    const now = new Date();

    const existing = this.registrations.get(key);

    if (existing) {
      existing.lastFetchAt = now;
      this.logger.debug(
        `Updated fetch time for pair ${pair.join('/')} from source ${source}`,
      );
    } else {
      this.createRegistration(pair, source, {
        registeredAt: now,
        lastFetchAt: now,
        lastResponseAt: new Date(0),
        lastRequestAt: now,
      });
      this.logger.debug(
        `Registered new pair ${pair.join('/')} for source ${source}`,
      );
    }
  }

  trackResponse(pair: Pair, source: SourceName): void {
    const key = this.getPairSourceKey(pair, source);
    const now = new Date();

    const existing = this.registrations.get(key);

    if (existing) {
      existing.lastResponseAt = now;
      this.logger.debug(
        `Updated response time for pair ${pair.join('/')} from source ${source}`,
      );
    } else {
      this.createRegistration(pair, source, {
        registeredAt: now,
        lastFetchAt: new Date(0),
        lastResponseAt: now,
        lastRequestAt: now,
      });
      this.logger.debug(
        `Registered new pair ${pair.join('/')} for source ${source}`,
      );
    }
  }

  getPairsBySource(source: SourceName): Pair[] {
    const pairKeys = this.pairsBySource.get(source);
    if (!pairKeys) {
      return [];
    }

    return Array.from(pairKeys).map((pairKey) => pairKey.split('/') as Pair);
  }

  getSourcesByPair(pair: Pair): string[] {
    const pairKey = this.getPairKey(pair);
    const sources = this.sourcesByPair.get(pairKey);

    return sources ? Array.from(sources) : [];
  }

  getAllRegistrations(): PairSourceRegistration[] {
    return Array.from(this.registrations.values());
  }

  removePairSource(pair: Pair, source: SourceName): void {
    const key = this.getPairSourceKey(pair, source);
    const removed = this.registrations.delete(key);

    if (removed) {
      this.removeFromIndices(pair, source);
      this.logger.debug(`Removed pair ${pair.join('/')} for source ${source}`);
    }
  }

  private getPairKey(pair: Pair): string {
    return pair.join('/');
  }

  private getPairSourceKey(pair: Pair, source: SourceName): string {
    return `${this.getPairKey(pair)}:${source}`;
  }

  private createRegistration(
    pair: Pair,
    source: SourceName,
    timestamps: Pick<
      PairSourceRegistration,
      'registeredAt' | 'lastFetchAt' | 'lastResponseAt' | 'lastRequestAt'
    >,
  ): void {
    const key = this.getPairSourceKey(pair, source);

    this.registrations.set(key, {
      pair,
      source,
      ...timestamps,
    });

    this.addToIndices(pair, source);
  }

  private addToIndices(pair: Pair, source: SourceName): void {
    const pairKey = this.getPairKey(pair);

    if (!this.pairsBySource.has(source)) {
      this.pairsBySource.set(source, new Set());
    }
    this.pairsBySource.get(source)!.add(pairKey);

    if (!this.sourcesByPair.has(pairKey)) {
      this.sourcesByPair.set(pairKey, new Set());
    }
    this.sourcesByPair.get(pairKey)!.add(source);
  }

  private removeFromIndices(pair: Pair, source: SourceName): void {
    const pairKey = this.getPairKey(pair);

    const sourcePairs = this.pairsBySource.get(source);
    if (sourcePairs) {
      sourcePairs.delete(pairKey);
      if (sourcePairs.size === 0) {
        this.pairsBySource.delete(source);
      }
    }

    const pairSources = this.sourcesByPair.get(pairKey);
    if (pairSources) {
      pairSources.delete(source);
      if (pairSources.size === 0) {
        this.sourcesByPair.delete(pairKey);
      }
    }
  }
}
