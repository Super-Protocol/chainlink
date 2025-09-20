import { Injectable, Logger } from '@nestjs/common';

import { AppConfigService } from '../config';
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

  constructor(private readonly configService: AppConfigService) {}

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
    const existing = this.registrations.get(key);

    if (existing) {
      existing.lastFetchAt = new Date();
      this.logger.debug(
        `Updated fetch time for pair ${pair.join('/')} from source ${source}`,
      );
    } else {
      this.logger.debug(
        `Skipping fetch tracking for unregistered pair ${pair.join('/')} from source ${source}`,
      );
    }
  }

  trackResponse(pair: Pair, source: SourceName): void {
    const key = this.getPairSourceKey(pair, source);
    const existing = this.registrations.get(key);

    if (existing) {
      existing.lastResponseAt = new Date();
      this.logger.debug(
        `Updated response time for pair ${pair.join('/')} from source ${source}`,
      );
    } else {
      this.logger.debug(
        `Skipping response tracking for unregistered pair ${pair.join('/')} from source ${source}`,
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

  getPairsBySourceWithTimestamps(source: SourceName): PairSourceRegistration[] {
    const pairKeys = this.pairsBySource.get(source);
    if (!pairKeys) {
      return [];
    }

    const registrations: PairSourceRegistration[] = [];
    for (const pairKey of pairKeys) {
      const pair: Pair = pairKey.split('/') as Pair;
      const registrationKey = this.getPairSourceKey(pair, source);
      const registration = this.registrations.get(registrationKey);
      if (registration) {
        registrations.push(registration);
      }
    }

    return registrations;
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

  cleanupInactivePairs(): number {
    const inactiveTimeoutMs = this.configService.get(
      'pairCleanup.inactiveTimeoutMs',
    );
    const now = new Date();
    const cutoffTime = new Date(now.getTime() - inactiveTimeoutMs);

    let removedCount = 0;
    const toRemove: Array<{ pair: Pair; source: SourceName }> = [];

    for (const registration of this.registrations.values()) {
      if (registration.lastRequestAt < cutoffTime) {
        toRemove.push({
          pair: registration.pair,
          source: registration.source,
        });
      }
    }

    for (const { pair, source } of toRemove) {
      this.removePairSource(pair, source);
      removedCount++;
    }

    if (removedCount > 0) {
      this.logger.log(`Cleaned up ${removedCount} inactive pairs`);
    }

    return removedCount;
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
