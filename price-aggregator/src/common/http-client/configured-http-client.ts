import { HttpService } from '@nestjs/axios';
import { Logger } from '@nestjs/common';
import { AxiosRequestConfig, AxiosResponse } from 'axios';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';

import {
  HttpClient,
  HttpProxyConfig,
  ProxyConfiguration,
} from './interfaces/http-client.interface';
import { RpsLimiterService } from './rps-limiter.service';
import { ClientParams, ClientParamsWithProxy } from './types/client-params';

export class ConfiguredHttpClient implements HttpClient {
  private readonly logger = new Logger(ConfiguredHttpClient.name);

  constructor(
    private readonly clientConfig: ClientParamsWithProxy,
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
      this.logger.debug(`Making ${method} request to ${requestUrl}`);
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
    clientConfig: ClientParamsWithProxy,
  ): AxiosRequestConfig {
    const config: AxiosRequestConfig = {
      ...baseConfig,
      params: {
        ...clientConfig.defaultParams,
        ...baseConfig.params,
      },
      timeout: clientConfig.timeoutMs,
    };

    if (clientConfig.useProxy && clientConfig.proxyConfig) {
      const proxyConfig = this.buildProxyConfig(clientConfig.proxyConfig);
      config.httpsAgent = proxyConfig.httpsAgent;
      config.httpAgent = proxyConfig.httpAgent;
    }

    return config;
  }

  private buildProxyConfig(proxyConfig: ProxyConfiguration) {
    const { http: httpConfig, https: httpsConfig } = proxyConfig;

    const httpsProxy = httpsConfig || httpConfig;
    const httpProxy = httpConfig || httpsConfig;

    return {
      httpsAgent: httpsProxy
        ? new HttpsProxyAgent(this.buildProxyUrl(httpsProxy))
        : undefined,
      httpAgent: httpProxy
        ? new HttpProxyAgent(this.buildProxyUrl(httpProxy))
        : undefined,
    };
  }

  private buildProxyUrl(config: HttpProxyConfig): string {
    const { host, port, username, password, protocol } = config;
    const auth = username && password ? `${username}:${password}@` : '';
    return `${protocol || 'http'}://${auth}${host}:${port}`;
  }

  private generateLimiterKey(url: string, config: ClientParams): string {
    const hostname = new URL(url).hostname;
    const rps = config.rps || 'unlimited';
    return `${hostname}-${rps}`;
  }
}
