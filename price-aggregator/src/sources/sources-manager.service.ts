import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import {
  SourceNotFoundException,
  SourceDisabledException,
  SourceUnsupportedException,
  BatchNotSupportedException,
  StreamingNotSupportedException,
} from './exceptions';
import { SourceAdapter, Quote, Pair } from './source-adapter.interface';
import { SourceName } from './source-name.enum';
import { SOURCES_MAP } from './sources.constants';

@Injectable()
export class SourcesManagerService {
  private readonly adaptersCache = new Map<SourceName, SourceAdapter>();

  constructor(private readonly moduleRef: ModuleRef) {}

  async fetchQuote(sourceName: string, pair: Pair): Promise<Quote> {
    const adapter = this.getAdapterByName(sourceName);
    return await adapter.fetchQuote(pair);
  }

  async fetchQuotes(sourceName: string, pairs: Pair[]): Promise<Quote[]> {
    const adapter = this.getAdapterByName(sourceName);

    if (!adapter.fetchQuotes) {
      throw new BatchNotSupportedException(sourceName);
    }

    return await adapter.fetchQuotes(pairs);
  }

  streamQuotes(sourceName: string, pairs: Pair[]): AsyncIterable<Quote> {
    const adapter = this.getAdapterByName(sourceName);

    if (!adapter.streamQuotes) {
      throw new StreamingNotSupportedException(sourceName);
    }

    return adapter.streamQuotes(pairs);
  }

  private getAdapter(sourceName: SourceName): SourceAdapter {
    if (this.adaptersCache.has(sourceName)) {
      const cachedAdapter = this.adaptersCache.get(sourceName)!;
      if (!cachedAdapter.enabled) {
        throw new SourceDisabledException(sourceName);
      }
      return cachedAdapter;
    }

    const AdapterClass = SOURCES_MAP[sourceName];
    if (!AdapterClass) {
      throw new SourceNotFoundException(sourceName);
    }

    const adapter = this.moduleRef.get<SourceAdapter>(AdapterClass);

    if (!adapter.enabled) {
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
