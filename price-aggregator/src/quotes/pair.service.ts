import { EventEmitter } from 'events';

import { Injectable, Logger } from '@nestjs/common';

import { AppConfigService } from '../config';
import { MetricsService } from '../metrics/metrics.service';
import { SourceName } from '../sources';
import { Pair } from '../sources/source-adapter.interface';

type PairServiceEvents = {
  'pair-added': { pair: Pair; source: SourceName };
  'pair-removed': { pair: Pair; source: SourceName };
};

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
  private readonly eventEmitter = new EventEmitter();

  constructor(
    private readonly configService: AppConfigService,
    private readonly metricsService: MetricsService,
  ) {}

  trackQuoteRequest(pair: Pair, source: SourceName): void {
    const key = this.getPairSourceKey(pair, source);
    const now = new Date();

    const existing = this.registrations.get(key);

    if (existing) {
      existing.lastRequestAt = now;
      this.logger.verbose(
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
      this.eventEmitter.emit('pair-added', { pair, source });
    }
  }

  trackSuccessfulFetch(pair: Pair, source: SourceName): void {
    const key = this.getPairSourceKey(pair, source);
    const existing = this.registrations.get(key);

    if (existing) {
      existing.lastFetchAt = new Date();
      this.logger.verbose(
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
      this.logger.verbose(
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
      this.eventEmitter.emit('pair-removed', { pair, source });
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
    this.pairsBySource.get(source)?.add(pairKey);

    if (!this.sourcesByPair.has(pairKey)) {
      this.sourcesByPair.set(pairKey, new Set());
    }
    this.sourcesByPair.get(pairKey)?.add(source);

    this.updateMetrics();
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

    this.updateMetrics();
  }

  private updateMetrics(): void {
    for (const source of Object.values(SourceName)) {
      const pairs = this.pairsBySource.get(source);
      this.metricsService.trackedPairs.set({ source }, pairs?.size || 0);
    }
    this.metricsService.totalPairs.set(this.sourcesByPair.size);
  }

  on<K extends keyof PairServiceEvents>(
    event: K,
    handler: (payload: PairServiceEvents[K]) => void,
  ): void {
    this.eventEmitter.on(event, handler as (...args: unknown[]) => void);
  }

  off<K extends keyof PairServiceEvents>(
    event: K,
    handler: (payload: PairServiceEvents[K]) => void,
  ): void {
    this.eventEmitter.off(event, handler as (...args: unknown[]) => void);
  }
}
