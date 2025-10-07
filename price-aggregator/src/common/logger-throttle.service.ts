import { Logger } from '@nestjs/common';

interface ThrottledLogEntry {
  lastLogTime: number;
  count: number;
}

export class ThrottledLogger {
  private readonly throttleMap = new Map<string, ThrottledLogEntry>();
  private readonly throttleInterval: number;

  constructor(
    private readonly logger: Logger,
    throttleIntervalMs = 1000,
  ) {
    this.throttleInterval = throttleIntervalMs;

    setInterval(() => {
      this.flushThrottledLogs();
    }, this.throttleInterval);
  }

  verbose(
    key: string,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    this.throttledLog('verbose', key, message, context);
  }

  debug(key: string, message: string, context?: Record<string, unknown>): void {
    this.throttledLog('debug', key, message, context);
  }

  private throttledLog(
    level: 'verbose' | 'debug',
    key: string,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    const now = Date.now();
    const entry = this.throttleMap.get(key);

    if (!entry) {
      this.throttleMap.set(key, { lastLogTime: now, count: 1 });
      this.logger[level](context || {}, message);
      return;
    }

    entry.count++;

    if (now - entry.lastLogTime >= this.throttleInterval) {
      if (entry.count > 1) {
        this.logger[level](
          { ...context, throttledCount: entry.count },
          `${message} (${entry.count} occurrences)`,
        );
      } else {
        this.logger[level](context || {}, message);
      }
      entry.lastLogTime = now;
      entry.count = 0;
    }
  }

  private flushThrottledLogs(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.throttleMap.entries()) {
      if (now - entry.lastLogTime >= this.throttleInterval * 2) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.throttleMap.delete(key);
    }
  }
}
