import { Injectable, Logger } from '@nestjs/common';
import Bottleneck from 'bottleneck';

export interface RpsLimiterOptions {
  rps?: number | null;
  maxConcurrent?: number;
}

@Injectable()
export class RpsLimiterService {
  private readonly logger = new Logger(RpsLimiterService.name);
  private limiters = new Map<string, Bottleneck>();

  createLimiter(key: string, options: RpsLimiterOptions): Bottleneck | null {
    if (options.rps === null || options.rps === undefined || options.rps <= 0) {
      this.logger.debug(`RPS limiting disabled for ${key}`);
      return null;
    }

    if (this.limiters.has(key)) {
      return this.limiters.get(key)!;
    }

    const minTime = Math.ceil(1000 / options.rps);
    const maxConcurrent = options.maxConcurrent || 10;

    const limiter = new Bottleneck({
      minTime,
      maxConcurrent,
      reservoir: options.rps,
      reservoirRefreshAmount: options.rps,
      reservoirRefreshInterval: 1000,
    });

    limiter.on('error', (error) => {
      this.logger.error(`Rate limiter error for ${key}:`, error);
    });

    limiter.on('failed', async (error, jobInfo) => {
      this.logger.warn(
        `Request failed for ${key}, retries: ${jobInfo.retryCount}`,
      );
      if (jobInfo.retryCount < 3) {
        return 1000 * Math.pow(2, jobInfo.retryCount);
      }
    });

    this.limiters.set(key, limiter);
    this.logger.debug(
      `Created rate limiter for ${key}: ${options.rps} RPS, ${maxConcurrent} concurrent`,
    );

    return limiter;
  }

  getLimiter(key: string): Bottleneck | null {
    return this.limiters.get(key) || null;
  }

  async executeWithLimit<T>(
    key: string,
    options: RpsLimiterOptions,
    fn: () => Promise<T>,
  ): Promise<T> {
    const limiter = this.createLimiter(key, options);

    if (!limiter) {
      return fn();
    }

    return limiter.schedule(fn);
  }

  removeLimiter(key: string): void {
    const limiter = this.limiters.get(key);
    if (limiter) {
      limiter.stop();
      this.limiters.delete(key);
      this.logger.debug(`Removed rate limiter for ${key}`);
    }
  }

  async shutdown(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [key, limiter] of this.limiters.entries()) {
      promises.push(limiter.stop());
      this.logger.debug(`Stopping rate limiter for ${key}`);
    }

    await Promise.all(promises);
    this.limiters.clear();
  }
}
