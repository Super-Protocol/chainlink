import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { register } from 'prom-client';

export interface RemoteWriteConfig {
  url: string;
  timeoutMs: number;
  headers?: Record<string, string>;
  basicAuth?: {
    username: string;
    password: string;
  };
}

@Injectable()
export class RemoteWriteClient {
  private readonly logger = new Logger(RemoteWriteClient.name);
  private readonly httpClient: AxiosInstance;

  constructor(private readonly config: RemoteWriteConfig) {
    const headers: Record<string, string> = {
      'Content-Type': 'text/plain',
      ...this.config.headers,
    };

    if (this.config.basicAuth) {
      const { username, password } = this.config.basicAuth;
      const credentials = Buffer.from(`${username}:${password}`).toString(
        'base64',
      );
      headers.Authorization = `Basic ${credentials}`;
    }

    this.httpClient = axios.create({
      timeout: this.config.timeoutMs,
      headers,
    });
  }

  async push(labels?: Record<string, string>): Promise<void> {
    const metrics = await register.metrics();

    let metricsWithLabels = metrics;
    if (labels && Object.keys(labels).length > 0) {
      metricsWithLabels = this.addLabelsToMetrics(metrics, labels);
    }

    this.logger.debug(
      {
        url: this.config.url,
        metricsSize: metricsWithLabels.length,
        labels,
      },
      'Pushing metrics to remote write endpoint',
    );

    await this.httpClient.post(this.config.url, metricsWithLabels);
  }

  private addLabelsToMetrics(
    metrics: string,
    labels: Record<string, string>,
  ): string {
    const lines = metrics.split('\n');
    const result: string[] = [];

    for (const line of lines) {
      if (line.startsWith('#') || line.trim() === '') {
        result.push(line);
        continue;
      }

      const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\{(.+)\}\s+(.+)$/);
      if (match) {
        const [, metricName, existingLabels, value] = match;
        const additionalLabels = Object.entries(labels)
          .map(([key, val]) => `${key}="${val}"`)
          .join(',');
        result.push(
          `${metricName}{${existingLabels},${additionalLabels}} ${value}`,
        );
      } else {
        const matchNoLabels = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\s+(.+)$/);
        if (matchNoLabels) {
          const [, metricName, value] = matchNoLabels;
          const additionalLabels = Object.entries(labels)
            .map(([key, val]) => `${key}="${val}"`)
            .join(',');
          result.push(`${metricName}{${additionalLabels}} ${value}`);
        } else {
          result.push(line);
        }
      }
    }

    return result.join('\n');
  }
}
