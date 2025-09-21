import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import {
  SourceNotFoundException,
  SourceDisabledException,
  SourceUnsupportedException,
  BatchNotSupportedException,
  StreamingNotSupportedException,
  FeatureNotImplementedException,
  SourceApiException,
} from './exceptions';
import { QuoteStreamService } from './quote-stream.interface';
import { SourceAdapter, Quote, Pair } from './source-adapter.interface';
import { SourceName } from './source-name.enum';
import { SOURCES_MAP } from './sources.providers';
import { SingleFlight } from '../common';
import { MetricsService } from '../metrics/metrics.service';

@Injectable()
export class SourcesManagerService {
  private readonly logger = new Logger(SourcesManagerService.name);
  private readonly adaptersCache = new Map<SourceName, SourceAdapter>();

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly metricsService: MetricsService,
  ) {}

  @SingleFlight((sourceName, pair) => `${sourceName}-${pair.join('-')}`)
  async fetchQuote(
    sourceName: SourceName | string,
    pair: Pair,
  ): Promise<Quote> {
    this.logger.debug(`Fetching ${sourceName} ${pair.join('-')}`);
    const endTimer = this.metricsService.fetchLatency.startTimer({
      source: sourceName,
    });

    try {
      const adapter = this.getAdapterByName(sourceName);
      const quote = await adapter.fetchQuote(pair);
      this.metricsService.quoteThroughput.inc({
        source: sourceName,
        status: 'success',
      });
      return quote;
    } catch (error) {
      this.metricsService.quoteThroughput.inc({
        source: sourceName,
        status: 'error',
      });

      if (error instanceof SourceApiException && error.statusCode === 429) {
        this.metricsService.rateLimitHits.inc({ source: sourceName });
      }

      throw error;
    } finally {
      endTimer();
    }
  }

  async fetchQuotes(
    sourceName: SourceName | string,
    pairs: Pair[],
  ): Promise<Quote[]> {
    this.logger.debug(
      `Batch fetching ${pairs.length} quotes for ${sourceName}`,
    );

    this.metricsService.batchSize.observe({ source: sourceName }, pairs.length);
    const endTimer = this.metricsService.fetchLatency.startTimer({
      source: sourceName,
    });

    try {
      const adapter = this.getAdapterByName(sourceName);

      if (!adapter.fetchQuotes) {
        throw new BatchNotSupportedException(sourceName);
      }

      const quotes = await adapter.fetchQuotes(pairs);
      this.metricsService.quoteThroughput.inc(
        {
          source: sourceName,
          status: 'success',
        },
        quotes.length,
      );
      return quotes;
    } catch (error) {
      this.metricsService.quoteThroughput.inc({
        source: sourceName,
        status: 'error',
      });

      if (error instanceof SourceApiException && error.statusCode === 429) {
        this.metricsService.rateLimitHits.inc({ source: sourceName });
      }

      throw error;
    } finally {
      endTimer();
    }
  }

  isFetchQuotesSupported(sourceName: SourceName | string): boolean {
    const adapter = this.getAdapterByName(sourceName);
    return adapter.fetchQuotes !== undefined;
  }

  getStreamService(sourceName: SourceName | string): QuoteStreamService {
    this.logger.debug(`Getting stream service for ${sourceName}`);
    const adapter = this.getAdapterByName(sourceName);

    if (!adapter.getStreamService) {
      throw new StreamingNotSupportedException(sourceName);
    }

    return adapter.getStreamService();
  }

  isStreamingSupported(sourceName: SourceName | string): boolean {
    const adapter = this.getAdapterByName(sourceName);
    return adapter.getStreamService !== undefined;
  }

  getStreamingSources(): SourceName[] {
    const streamingSources: SourceName[] = [];

    for (const name of Object.values(SourceName)) {
      try {
        if (this.isEnabled(name) && this.isStreamingSupported(name)) {
          streamingSources.push(name);
        }
      } catch (error) {
        // Ignore disabled or unavailable sources
      }
    }

    return streamingSources;
  }

  @SingleFlight((sourceName) => `${sourceName}-pairs`)
  async getPairs(sourceName: SourceName | string): Promise<Pair[]> {
    this.logger.debug(`Fetching pairs for ${sourceName}`);
    const adapter = this.getAdapterByName(sourceName);

    if (!adapter.getPairs) {
      throw new FeatureNotImplementedException('get pairs', sourceName);
    }

    return adapter.getPairs();
  }

  isGetPairsSupported(sourceName: SourceName | string): boolean {
    const adapter = this.getAdapterByName(sourceName);
    return adapter.getPairs !== undefined;
  }

  isEnabled(sourceName: SourceName | string): boolean {
    try {
      const adapter = this.getAdapterByName(sourceName);
      return adapter.isEnabled();
    } catch (error) {
      if (error instanceof SourceDisabledException) {
        return false;
      }
      throw error;
    }
  }

  getTtl(sourceName: SourceName | string): number {
    return this.getAdapterByName(sourceName).getTtl();
  }

  isRefetchEnabled(sourceName: SourceName | string): boolean {
    return this.getAdapterByName(sourceName).isRefetchEnabled();
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

  private getAdapterByName(sourceName: SourceName | string): SourceAdapter {
    const sourceNameEnum = this.validateSourceName(sourceName);
    return this.getAdapter(sourceNameEnum);
  }

  private isSourceSupported(sourceName: SourceName | string): boolean {
    return Object.values(SourceName).includes(sourceName as SourceName);
  }

  private validateSourceName(sourceName: SourceName | string): SourceName {
    if (!this.isSourceSupported(sourceName)) {
      const supportedSources = Object.values(SourceName);
      throw new SourceUnsupportedException(sourceName, supportedSources);
    }
    return sourceName as SourceName;
  }
}
