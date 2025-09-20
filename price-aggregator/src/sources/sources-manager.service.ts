import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import {
  SourceNotFoundException,
  SourceDisabledException,
  SourceUnsupportedException,
  BatchNotSupportedException,
  StreamingNotSupportedException,
  FeatureNotImplementedException,
} from './exceptions';
import { SourceAdapter, Quote, Pair } from './source-adapter.interface';
import { SourceName } from './source-name.enum';
import { SOURCES_MAP } from './sources.constants';
import { SingleFlight } from '../common';

@Injectable()
export class SourcesManagerService {
  private readonly logger = new Logger(SourcesManagerService.name);
  private readonly adaptersCache = new Map<SourceName, SourceAdapter>();

  constructor(private readonly moduleRef: ModuleRef) {}

  @SingleFlight((sourceName, pair) => `${sourceName}-${pair.join('-')}`)
  async fetchQuote(sourceName: string, pair: Pair): Promise<Quote> {
    this.logger.debug(`Fetching ${sourceName} ${pair.join('-')}`);
    const adapter = this.getAdapterByName(sourceName);
    return adapter.fetchQuote(pair);
  }

  async fetchQuotes(sourceName: string, pairs: Pair[]): Promise<Quote[]> {
    this.logger.debug(
      `Batch fetching ${pairs.length} quotes for ${sourceName}`,
    );
    const adapter = this.getAdapterByName(sourceName);

    if (!adapter.fetchQuotes) {
      throw new BatchNotSupportedException(sourceName);
    }

    return adapter.fetchQuotes(pairs);
  }

  isFetchQuotesSupported(sourceName: string): boolean {
    const adapter = this.getAdapterByName(sourceName);
    return adapter.fetchQuotes !== undefined;
  }

  streamQuotes(sourceName: string, pairs: Pair[]): AsyncIterable<Quote> {
    this.logger.debug(
      `Starting stream for ${sourceName}, ${pairs.length} pairs`,
    );
    const adapter = this.getAdapterByName(sourceName);

    if (!adapter.streamQuotes) {
      throw new StreamingNotSupportedException(sourceName);
    }

    return adapter.streamQuotes(pairs);
  }

  isStreamQuotesSupported(sourceName: string): boolean {
    const adapter = this.getAdapterByName(sourceName);
    return adapter.streamQuotes !== undefined;
  }

  async getPairs(sourceName: string): Promise<Pair[]> {
    this.logger.debug(`Fetching pairs for ${sourceName}`);
    const adapter = this.getAdapterByName(sourceName);

    if (!adapter.getPairs) {
      throw new FeatureNotImplementedException('get pairs', sourceName);
    }

    return adapter.getPairs();
  }

  isGetPairsSupported(sourceName: string): boolean {
    const adapter = this.getAdapterByName(sourceName);
    return adapter.getPairs !== undefined;
  }

  private getAdapter(sourceName: SourceName): SourceAdapter {
    if (this.adaptersCache.has(sourceName)) {
      const cachedAdapter = this.adaptersCache.get(sourceName)!;
      if (!cachedAdapter.isEnabled()) {
        throw new SourceDisabledException(sourceName);
      }
      return cachedAdapter;
    }

    const AdapterClass = SOURCES_MAP[sourceName];
    if (!AdapterClass) {
      throw new SourceNotFoundException(sourceName);
    }

    const adapter = this.moduleRef.get<SourceAdapter>(AdapterClass);

    if (!adapter.isEnabled()) {
      throw new SourceDisabledException(sourceName);
    }

    this.adaptersCache.set(sourceName, adapter);
    return adapter;
  }

  private getAdapterByName(sourceName: string): SourceAdapter {
    const sourceNameEnum = this.validateSourceName(sourceName);
    return this.getAdapter(sourceNameEnum);
  }

  private isSourceSupported(sourceName: string): boolean {
    return Object.values(SourceName).includes(sourceName as SourceName);
  }

  private validateSourceName(sourceName: string): SourceName {
    if (!this.isSourceSupported(sourceName)) {
      const supportedSources = Object.values(SourceName);
      throw new SourceUnsupportedException(sourceName, supportedSources);
    }
    return sourceName as SourceName;
  }
}
