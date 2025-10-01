import { HttpService } from '@nestjs/axios';
import { Logger } from '@nestjs/common';
import { AxiosRequestConfig, AxiosResponse } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

import { HttpClient } from './interfaces/http-client.interface';
import { RpsLimiterService } from './rps-limiter.service';
import { ClientOptions } from './types/client-params';
import { sanitizeUrlForLogging } from './url-sanitizer';

export class ConfiguredHttpClient implements HttpClient {
  private readonly logger = new Logger(ConfiguredHttpClient.name);

  constructor(
    private readonly clientConfig: ClientOptions,
    private readonly httpService: HttpService,
    private readonly rpsLimiter: RpsLimiterService,
  ) {}

  get<T = Record<string, unknown>>(
    url: string,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    return this.execute<T>('GET', url, undefined, config);
  }

  post<T = Record<string, unknown>, D = unknown>(
    url: string,
    data?: D,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    return this.execute<T>('POST', url, data, config);
  }

  put<T = Record<string, unknown>, D = unknown>(
    url: string,
    data?: D,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    return this.execute<T>('PUT', url, data, config);
  }

  patch<T = Record<string, unknown>, D = unknown>(
    url: string,
    data?: D,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    return this.execute<T>('PATCH', url, data, config);
  }

  delete<T = Record<string, unknown>>(
    url: string,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    return this.execute<T>('DELETE', url, undefined, config);
  }

  private async execute<T = Record<string, unknown>>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    data?: unknown,
    axiosConfig?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    const requestUrl = this.clientConfig.baseUrl
      ? new URL(url, this.clientConfig.baseUrl).toString()
      : url;

    const enhancedConfig = this.buildRequestConfig(
      axiosConfig || {},
      this.clientConfig,
    );
    const limiterKey = this.generateLimiterKey(requestUrl, this.clientConfig);

    const requestFn = () => {
      const safeUrlForLog = sanitizeUrlForLogging(requestUrl);
      this.logger.debug(`HTTP ${method} ${safeUrlForLog}`);
      return this.httpService.axiosRef.request<T>({
        method,
        url: requestUrl,
        data,
        ...enhancedConfig,
      });
    };

    return this.rpsLimiter.executeWithLimit(
      limiterKey,
      {
        rps: this.clientConfig.rps,
        maxConcurrent: this.clientConfig.maxConcurrent,
        maxRetries: this.clientConfig.maxRetries,
      },
      requestFn,
    );
  }

  private buildRequestConfig(
    baseConfig: AxiosRequestConfig,
    clientConfig: ClientOptions,
  ): AxiosRequestConfig {
    const config: AxiosRequestConfig = {
      ...baseConfig,
      params: {
        ...clientConfig.defaultParams,
        ...baseConfig.params,
      },
      timeout: clientConfig.timeoutMs,
    };

    if (clientConfig.proxyUrl) {
      config.httpsAgent = new HttpsProxyAgent(clientConfig.proxyUrl);
    }

    return config;
  }

  private generateLimiterKey(url: string, config: ClientOptions): string {
    const hostname = new URL(url).hostname;
    const rps = config.rps || 'unlimited';
    return `${hostname}-${rps}`;
  }
}
