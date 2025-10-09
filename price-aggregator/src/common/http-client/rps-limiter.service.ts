import { Injectable, Logger } from '@nestjs/common';
import { isAxiosError } from 'axios';
import Bottleneck from 'bottleneck';

export interface RpsLimiterOptions {
  rps?: number | null;
  maxConcurrent?: number;
  maxRetries: number;
}

function shouldRetryError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  if (isAxiosError(error)) {
    if (!error.response) {
      return true;
    }
    const status = error.response.status;
    if (status >= 500 || status === 429 || status === 408) {
      return true;
    }
    return false;
  }

  if (error instanceof Error) {
    const errorMessage = error.message.toLowerCase();
    const networkErrorPatterns = [
      'network error',
      'connection',
      'timeout',
      'econnreset',
      'enotfound',
      'econnrefused',
      'socket hang up',
    ];

    return networkErrorPatterns.some((pattern) =>
      errorMessage.includes(pattern),
    );
  }

  return false;
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
      const shouldRetry = shouldRetryError(error);
      const statusCode = isAxiosError(error)
        ? (error.response?.status ?? 'network-error')
        : 'unknown';

      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorCode = isAxiosError(error) ? error.code : undefined;

      this.logger.warn(
        `Request failed for ${key}, retries: ${jobInfo.retryCount}, status: ${statusCode}, code: ${errorCode}, shouldRetry: ${shouldRetry}, error: ${errorMessage}`,
      );

      const maxRetries = options.maxRetries;
      if (shouldRetry && jobInfo.retryCount < maxRetries) {
        this.logger.debug(
          `Retrying request for ${key} immediately (attempt ${jobInfo.retryCount + 1}/${maxRetries})`,
        );
        return 0;
      }

      if (!shouldRetry) {
        this.logger.debug(
          `Not retrying request for ${key} - error type not retryable (status: ${statusCode})`,
        );
      }

      return undefined;
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
