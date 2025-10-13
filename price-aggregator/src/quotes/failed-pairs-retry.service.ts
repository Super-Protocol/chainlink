import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';

import {
  RetryMetadata,
  FailedPairsRetryConfig,
} from './failed-pairs-retry.interface';
import { formatPairLabel } from '../common';
import { AppConfigService } from '../config/config.service';
import { MetricsService } from '../metrics/metrics.service';
import { SourceName } from '../sources';
import { Pair } from '../sources/source-adapter.interface';

@Injectable()
export class FailedPairsRetryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FailedPairsRetryService.name);
  private failedPairs = new Map<string, RetryMetadata>();
  private checkInterval: NodeJS.Timeout | null = null;
  private config: FailedPairsRetryConfig;
  private onRetryCallback:
    | ((pairs: Array<{ source: SourceName; pair: Pair }>) => Promise<void>)
    | null = null;

  constructor(
    private readonly configService: AppConfigService,
    private readonly metricsService: MetricsService,
  ) {
    this.config = this.configService.get('refetch.failedPairsRetry');
  }

  onModuleInit(): void {
    if (!this.config.enabled) {
      this.logger.log('Failed pairs retry service is disabled');
      return;
    }

    this.startCheckInterval();
    this.logger.log(
      { config: this.config },
      'Failed pairs retry service initialized',
    );
  }

  onModuleDestroy(): void {
    this.stopCheckInterval();
    this.logger.log('Failed pairs retry service destroyed');
  }

  registerRetryCallback(
    callback: (
      pairs: Array<{ source: SourceName; pair: Pair }>,
    ) => Promise<void>,
  ): void {
    this.onRetryCallback = callback;
  }

  trackFailedPair(source: SourceName, pair: Pair): void {
    if (!this.config.enabled) {
      return;
    }

    const key = this.generateKey(source, pair);
    const existing = this.failedPairs.get(key);

    if (existing) {
      if (existing.attempt >= this.config.maxAttempts) {
        this.logger.warn(
          { source, pair: formatPairLabel(pair), attempts: existing.attempt },
          `Max retry attempts reached for ${formatPairLabel(pair)} from ${source}, removing from retry queue`,
        );
        this.failedPairs.delete(key);
        this.metricsService.failedPairsCount.set(this.failedPairs.size);
        this.metricsService.failedPairsMaxAttemptsReached.inc({
          source,
          pair: formatPairLabel(pair),
        });
        return;
      }

      const now = new Date();
      const metadata: RetryMetadata = {
        ...existing,
        attempt: existing.attempt + 1,
        lastAttemptAt: now,
        nextRetryAt: new Date(now.getTime() + this.config.retryDelay),
      };

      this.failedPairs.set(key, metadata);
      this.metricsService.failedPairsRetryAttempts.inc({
        source,
        pair: formatPairLabel(pair),
      });
      this.logger.debug(
        {
          source,
          pair: formatPairLabel(pair),
          attempt: metadata.attempt,
          nextRetryAt: metadata.nextRetryAt,
        },
        `Updated retry metadata for ${formatPairLabel(pair)} from ${source}`,
      );
    } else {
      const now = new Date();
      const metadata: RetryMetadata = {
        source,
        pair,
        attempt: 1,
        lastAttemptAt: now,
        nextRetryAt: new Date(now.getTime() + this.config.retryDelay),
        firstFailedAt: now,
      };

      this.failedPairs.set(key, metadata);
      this.metricsService.failedPairsCount.set(this.failedPairs.size);
      this.metricsService.failedPairsRetryAttempts.inc({
        source,
        pair: formatPairLabel(pair),
      });
      this.logger.debug(
        {
          source,
          pair: formatPairLabel(pair),
          nextRetryAt: metadata.nextRetryAt,
        },
        `Added ${formatPairLabel(pair)} from ${source} to retry queue`,
      );
    }
  }

  removeFromRetryQueue(source: SourceName, pair: Pair): void {
    const key = this.generateKey(source, pair);
    const metadata = this.failedPairs.get(key);

    if (metadata) {
      this.failedPairs.delete(key);
      this.metricsService.failedPairsCount.set(this.failedPairs.size);
      this.logger.debug(
        {
          source,
          pair: formatPairLabel(pair),
          totalAttempts: metadata.attempt,
          duration: Date.now() - metadata.firstFailedAt.getTime(),
        },
        `Removed ${formatPairLabel(pair)} from ${source} from retry queue after success`,
      );
    }
  }

  private startCheckInterval(): void {
    this.checkInterval = setInterval(() => {
      this.checkAndRetryPairs().catch((error) => {
        this.logger.error({ error: String(error) }, 'Error during retry check');
      });
    }, this.config.checkInterval);

    this.logger.debug(
      { interval: this.config.checkInterval },
      'Started retry check interval',
    );
  }

  private stopCheckInterval(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  private async checkAndRetryPairs(): Promise<void> {
    const now = Date.now();
    const readyPairs: Array<{ source: SourceName; pair: Pair }> = [];

    for (const [_key, metadata] of this.failedPairs.entries()) {
      if (now >= metadata.nextRetryAt.getTime()) {
        readyPairs.push({ source: metadata.source, pair: metadata.pair });
      }
    }

    if (readyPairs.length === 0) {
      return;
    }

    this.logger.debug(
      { count: readyPairs.length },
      `Found ${readyPairs.length} pairs ready for retry`,
    );

    if (this.onRetryCallback) {
      await this.onRetryCallback(readyPairs);
    }
  }

  getRetryStatus(): {
    enabled: boolean;
    config: FailedPairsRetryConfig;
    failedPairsCount: number;
    failedPairs: Array<{
      source: SourceName;
      pair: Pair;
      attempt: number;
      nextRetryAt: Date;
      firstFailedAt: Date;
    }>;
  } {
    return {
      enabled: this.config.enabled,
      config: this.config,
      failedPairsCount: this.failedPairs.size,
      failedPairs: Array.from(this.failedPairs.values()).map((metadata) => ({
        source: metadata.source,
        pair: metadata.pair,
        attempt: metadata.attempt,
        nextRetryAt: metadata.nextRetryAt,
        firstFailedAt: metadata.firstFailedAt,
      })),
    };
  }

  private generateKey(source: SourceName, pair: Pair): string {
    return `${source}:${formatPairLabel(pair)}`;
  }
}
