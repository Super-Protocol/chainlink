import * as os from 'os';

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';

import { AppConfigService } from '../config';
import { RemoteWriteClient } from './remote-write.client';
import { MetricsPushConfig } from '../config/schema/metrics-push.schema';

@Injectable()
export class PushMetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PushMetricsService.name);
  private pushInterval?: NodeJS.Timeout;
  private remoteWriteClient?: RemoteWriteClient;
  private labels: Record<string, string>;
  private readonly config: MetricsPushConfig;

  constructor(private readonly configService: AppConfigService) {
    this.config = this.configService.get('metricsPush');
  }

  async onModuleInit(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.debug('Push metrics disabled, skipping initialization');
      return;
    }

    if (!this.config.url) {
      this.logger.error('Push metrics enabled but no URL provided');
      return;
    }

    this.logger.log('Initializing push metrics service');

    this.labels = {
      job: this.config.jobName,
      instance: os.hostname(),
      ...this.config.groupingLabels,
    };

    this.remoteWriteClient = new RemoteWriteClient({
      url: this.config.url,
      timeoutMs: this.config.timeoutMs,
      headers: this.config.headers,
      basicAuth: this.config.basicAuth,
    });

    this.pushInterval = setInterval(() => {
      this.pushMetrics();
    }, this.config.intervalMs);

    this.logger.log(
      {
        labels: this.labels,
        interval: this.config.intervalMs,
        url: this.config.url,
      },
      'Push metrics initialized',
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pushInterval) {
      clearInterval(this.pushInterval);
      this.pushInterval = undefined;
    }

    this.logger.log('Push metrics service destroyed');
  }

  private async pushMetrics(): Promise<void> {
    if (!this.remoteWriteClient) {
      return;
    }

    try {
      await this.remoteWriteClient.push(this.labels);
      this.logger.debug('Metrics pushed successfully');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(
        {
          err,
          url: this.config.url,
          labels: this.labels,
          message: err.message,
        },
        'Failed to push metrics',
      );
    }
  }
}
