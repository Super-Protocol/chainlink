import { EventEmitter } from 'events';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { formatPairLabel, parsePairLabel } from '../common';
import { AppConfigService } from '../config';
import { MetricsService } from '../metrics/metrics.service';
import { SourceName } from '../sources';
import { Pair } from '../sources/source-adapter.interface';
import { SourcesManagerService } from '../sources/sources-manager.service';

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
export class PairService implements OnModuleInit {
  private readonly logger = new Logger(PairService.name);
  private readonly registrations = new Map<string, PairSourceRegistration>();
  private readonly pairsBySource = new Map<SourceName, Set<string>>();
  private readonly sourcesByPair = new Map<string, Set<SourceName>>();
  private readonly eventEmitter = new EventEmitter();

  constructor(
    private readonly configService: AppConfigService,
    private readonly metricsService: MetricsService,
    private readonly sourcesManager: SourcesManagerService,
  ) {}

  async onModuleInit(): Promise<void> {
    const pairsFilePath = this.configService.get('pairsFilePath');

    if (!pairsFilePath) {
      return;
    }

    await this.preloadPairsFromFile(pairsFilePath);
  }

  trackQuoteRequest(pair: Pair, source: SourceName): void {
    const key = this.getPairSourceKey(pair, source);
    const now = new Date();

    const existing = this.registrations.get(key);

    if (existing) {
      existing.lastRequestAt = now;
      this.logger.verbose(
        `Updated request time for pair ${formatPairLabel(pair)} from source ${source}`,
      );
    } else {
      this.createRegistration(pair, source, {
        registeredAt: now,
        lastFetchAt: new Date(0),
        lastResponseAt: new Date(0),
        lastRequestAt: now,
      });
      this.logger.debug(
        `Started tracking pair ${formatPairLabel(pair)} for source ${source}`,
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
        `Updated fetch time for pair ${formatPairLabel(pair)} from source ${source}`,
      );
    } else {
      this.logger.debug(
        `Skipping fetch tracking for unregistered pair ${formatPairLabel(pair)} from source ${source}`,
      );
    }
  }

  trackResponse(pair: Pair, source: SourceName): void {
    const key = this.getPairSourceKey(pair, source);
    const existing = this.registrations.get(key);

    if (existing) {
      existing.lastResponseAt = new Date();
      this.logger.verbose(
        `Updated response time for pair ${formatPairLabel(pair)} from source ${source}`,
      );
    } else {
      this.logger.debug(
        `Skipping response tracking for unregistered pair ${formatPairLabel(pair)} from source ${source}`,
      );
    }
  }

  getPairsBySource(source: SourceName): Pair[] {
    const pairKeys = this.pairsBySource.get(source);
    if (!pairKeys) {
      return [];
    }

    return Array.from(pairKeys).map((pairLabel) => parsePairLabel(pairLabel));
  }

  getPairsBySourceWithTimestamps(source: SourceName): PairSourceRegistration[] {
    const pairKeys = this.pairsBySource.get(source);
    if (!pairKeys) {
      return [];
    }

    const registrations: PairSourceRegistration[] = [];
    for (const pairLabel of pairKeys) {
      const pair = parsePairLabel(pairLabel);
      const registrationKey = this.getPairSourceKey(pair, source);
      const registration = this.registrations.get(registrationKey);
      if (registration) {
        registrations.push(registration);
      }
    }

    return registrations;
  }

  getSourcesByPair(pair: Pair): SourceName[] {
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
      this.metricsService.removePairMetrics(pair, source);
      this.logger.debug(
        `Removed pair ${formatPairLabel(pair)} for source ${source}`,
      );
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
    return formatPairLabel(pair);
  }

  private getPairSourceKey(pair: Pair, source: SourceName): string {
    return `${this.getPairKey(pair)}:${source}`;
  }

  private async preloadPairsFromFile(filePath: string): Promise<void> {
    try {
      const resolvedPath = isAbsolute(filePath)
        ? filePath
        : resolve(process.cwd(), filePath);
      const fileContent = await readFile(resolvedPath, 'utf8');

      if (!fileContent.trim()) {
        this.logger.warn({ filePath: resolvedPath }, 'Pairs file is empty');
        return;
      }

      const rawData = JSON.parse(fileContent);
      const loadedPairs = this.loadPairs(rawData);

      if (loadedPairs === 0) {
        this.logger.debug(
          { filePath: resolvedPath },
          'No new pairs were preloaded from file',
        );
        return;
      }

      this.logger.log(
        { filePath: resolvedPath, count: loadedPairs },
        'Preloaded pairs from file',
      );
    } catch (error) {
      this.logger.error(
        { filePath },
        'Failed to preload pairs from file',
        error as Error,
      );
    }
  }

  private loadPairs(rawData: unknown): number {
    if (!rawData || typeof rawData !== 'object') {
      this.logger.warn({}, 'Pairs file must contain an object at root');
      return 0;
    }

    let loadedCount = 0;

    for (const [sourceKey, values] of Object.entries(rawData)) {
      if (!this.isSupportedSource(sourceKey)) {
        this.logger.warn({ source: sourceKey }, 'Skipping unknown source');
        continue;
      }

      if (!this.sourcesManager.isEnabled(sourceKey)) {
        this.logger.debug({ source: sourceKey }, 'Skipping disabled source');
        continue;
      }

      if (!Array.isArray(values)) {
        this.logger.warn(
          { source: sourceKey },
          'Pairs list must be an array of strings',
        );
        continue;
      }

      const sourceName = sourceKey as SourceName;

      for (const value of values) {
        const pair = this.parsePair(value);

        if (!pair) {
          this.logger.warn({ source: sourceKey, value }, 'Invalid pair value');
          continue;
        }

        loadedCount += this.registerPreloadedPair(pair, sourceName) ? 1 : 0;
      }
    }

    return loadedCount;
  }

  private isSupportedSource(sourceKey: string): sourceKey is SourceName {
    return Object.values(SourceName).includes(sourceKey as SourceName);
  }

  private parsePair(value: unknown): Pair | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const [base, quote, ...rest] = parsePairLabel(value).map((part) =>
      part.trim(),
    );

    if (!base || !quote || rest.length > 0) {
      return undefined;
    }

    return [base, quote];
  }

  private registerPreloadedPair(pair: Pair, source: SourceName): boolean {
    const key = this.getPairSourceKey(pair, source);

    if (this.registrations.has(key)) {
      return false;
    }

    const now = new Date();

    this.createRegistration(pair, source, {
      registeredAt: now,
      lastFetchAt: new Date(0),
      lastResponseAt: new Date(0),
      lastRequestAt: now,
    });

    this.logger.debug(
      { source, pair: formatPairLabel(pair) },
      'Preloaded pair registration created',
    );

    this.eventEmitter.emit('pair-added', { pair, source });

    return true;
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

    this.metricsService.registeredPairs.set({ pair: pairKey, source }, 1);

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
