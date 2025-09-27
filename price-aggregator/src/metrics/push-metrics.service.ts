import * as os from 'os';

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Pushgateway, register, RegistryContentType } from 'prom-client';

import { AppConfigService } from '../config';
import { MetricsPushConfig } from '../config/schema/metrics-push.schema';

@Injectable()
export class PushMetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PushMetricsService.name);
  private pushInterval?: NodeJS.Timeout;
  private gateway?: Pushgateway<RegistryContentType>;
  private jobName: string;
  private groupingLabels: Record<string, string>;
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

    this.jobName = this.config.jobName;
    this.groupingLabels = {
      service: 'price-aggregator',
      instance: os.hostname(),
      ...this.config.groupingLabels,
    };

    const headers: Record<string, string> = { ...this.config.headers };

    if (this.config.basicAuth) {
      const { username, password } = this.config.basicAuth;
      const credentials = Buffer.from(`${username}:${password}`).toString(
        'base64',
      );
      headers.Authorization = `Basic ${credentials}`;
    }
    this.gateway = new Pushgateway(
      this.config.url,
      {
        timeout: this.config.timeoutMs,
        headers,
      },
      register,
    );

    this.pushInterval = setInterval(() => {
      this.pushMetrics();
    }, this.config.intervalMs);

    this.logger.log(
      `Push metrics initialized: job=${this.jobName}, interval=${this.config.intervalMs}ms, url=${this.config.url}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pushInterval) {
      clearInterval(this.pushInterval);
      this.pushInterval = undefined;
    }

    if (this.config.deleteOnShutdown && this.gateway) {
      try {
        await this.deleteMetrics();
        this.logger.log('Metrics deleted from push gateway on shutdown');
      } catch (error) {
        this.logger.warn('Failed to delete metrics on shutdown', error);
      }
    }

    this.logger.log('Push metrics service destroyed');
  }

  private async pushMetrics(): Promise<void> {
    if (!this.gateway) {
      return;
    }

    try {
      await this.gateway.push({
        jobName: this.jobName,
        groupings: this.groupingLabels,
      });

      this.logger.debug('Metrics pushed successfully');
    } catch (error) {
      this.logger.warn(
        { err: error instanceof Error ? error : new Error(String(error)) },
        'Failed to push metrics',
      );
    }
  }

  private async deleteMetrics(): Promise<void> {
    if (!this.gateway) {
      return;
    }

    await this.gateway.delete({
      jobName: this.jobName,
      groupings: this.groupingLabels,
    });
  }
}
