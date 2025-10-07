import { Injectable, Logger } from '@nestjs/common';

import { CachedQuote, CacheService } from './cache';
import { PairService } from './pair.service';
import { MetricsService } from '../metrics/metrics.service';
import { SourceName } from '../sources';
import { Pair, Quote } from '../sources/source-adapter.interface';

interface QuoteBatch {
  source: SourceName;
  quote: Quote;
}

interface CacheWriteOperation {
  cachedQuote: CachedQuote;
}

@Injectable()
export class QuoteBatchProcessorService {
  private readonly logger = new Logger(QuoteBatchProcessorService.name);
  private quotesQueue: QuoteBatch[] = [];
  private cacheWriteQueue: CacheWriteOperation[] = [];
  private flushTimer?: NodeJS.Timeout;
  private readonly batchSize = 50;
  private readonly flushInterval = 100;
  private isProcessing = false;

  constructor(
    private readonly cacheService: CacheService,
    private readonly pairService: PairService,
    private readonly metricsService: MetricsService,
  ) {
    this.startBatchProcessor();
  }

  enqueueQuote(source: SourceName, quote: Quote): void {
    this.quotesQueue.push({ source, quote });

    if (this.quotesQueue.length >= this.batchSize) {
      this.scheduleBatchFlush();
    }
  }

  private startBatchProcessor(): void {
    setInterval(() => {
      if (this.quotesQueue.length > 0 || this.cacheWriteQueue.length > 0) {
        this.processBatches();
      }
    }, this.flushInterval);
  }

  private scheduleBatchFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }

    this.flushTimer = setTimeout(() => {
      this.processBatches();
    }, 10);
  }

  private async processBatches(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      await this.processQuoteBatch();
      await this.processCacheWriteBatch();
    } catch (error) {
      this.logger.error('Error processing batches', error as Error);
    } finally {
      this.isProcessing = false;
    }
  }

  private async processQuoteBatch(): Promise<void> {
    if (this.quotesQueue.length === 0) {
      return;
    }

    const batch = this.quotesQueue.splice(0, this.quotesQueue.length);

    const cacheWrites: CacheWriteOperation[] = [];
    const metricsUpdates = new Map<SourceName, number>();
    const pairUpdates = new Map<string, { pair: Pair; source: SourceName }>();

    for (const { source, quote } of batch) {
      const cachedQuote: CachedQuote = {
        source,
        pair: quote.pair,
        price: quote.price,
        receivedAt: quote.receivedAt,
        cachedAt: new Date(),
      };

      cacheWrites.push({ cachedQuote });

      const pairKey = `${source}:${quote.pair.join('/')}`;
      pairUpdates.set(pairKey, { pair: quote.pair, source });

      const count = metricsUpdates.get(source) || 0;
      metricsUpdates.set(source, count + 1);
    }

    this.cacheWriteQueue.push(...cacheWrites);

    for (const { pair, source } of pairUpdates.values()) {
      this.pairService.trackSuccessfulFetch(pair, source);
      this.metricsService.updateSourceLastUpdate(source, pair);
    }

    for (const [source, count] of metricsUpdates.entries()) {
      this.metricsService.quoteThroughput.inc(
        { source, status: 'success' },
        count,
      );
    }
  }

  private async processCacheWriteBatch(): Promise<void> {
    if (this.cacheWriteQueue.length === 0) {
      return;
    }

    const batch = this.cacheWriteQueue.splice(0, this.cacheWriteQueue.length);

    const quotesToCache = batch.map((item) => item.cachedQuote);
    await this.cacheService.setMany(quotesToCache);
    this.cacheService.deferredUpdateCacheSizeMetrics();
  }

  async flush(): Promise<void> {
    await this.processBatches();
  }
}
