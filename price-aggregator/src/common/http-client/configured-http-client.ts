import { HttpService } from '@nestjs/axios';
import { Logger } from '@nestjs/common';
import { AxiosProxyConfig, AxiosRequestConfig, AxiosResponse } from 'axios';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';

import {
  HttpClient,
  HttpClientConfig,
  ProxyConfig,
} from './interfaces/http-client.interface';
import { RpsLimiterService } from './rps-limiter.service';

export class ConfiguredHttpClient implements HttpClient {
  private readonly logger = new Logger(ConfiguredHttpClient.name);

  constructor(
    private readonly clientConfig: HttpClientConfig,
    private readonly httpService: HttpService,
    private readonly rpsLimiter: RpsLimiterService,
  ) {}

  get<T>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.execute<T>('GET', url, undefined, config);
  }

  post<T, D = unknown>(
    url: string,
    data?: D,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    return this.execute<T>('POST', url, data, config);
  }

  put<T, D = unknown>(
    url: string,
    data?: D,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    return this.execute<T>('PUT', url, data, config);
  }

  patch<T, D = unknown>(
    url: string,
    data?: D,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    return this.execute<T>('PATCH', url, data, config);
  }

  delete<T>(
    url: string,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    return this.execute<T>('DELETE', url, undefined, config);
  }

  private async execute<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    data?: unknown,
    axiosConfig?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    const requestUrl = this.clientConfig.baseUrl
      ? `${this.clientConfig.baseUrl}${url}`
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
      },
      requestFn,
    );
  }

  private buildRequestConfig(
    baseConfig: AxiosRequestConfig,
    clientConfig: HttpClientConfig,
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
      config.proxy = proxyConfig.axiosProxy;
      config.httpsAgent = proxyConfig.httpsAgent;
      config.httpAgent = proxyConfig.httpAgent;
    }

    return config;
  }

  private buildProxyConfig(proxyConfig: ProxyConfig) {
    const { host, port, username, password } = proxyConfig;

    const proxyUrl =
      username && password
        ? `http://${username}:${password}@${host}:${port}`
        : `http://${host}:${port}`;

    const axiosProxy: AxiosProxyConfig = {
      host,
      port,
      ...(username && { auth: { username, password: password || '' } }),
    };

    return {
      axiosProxy,
      httpsAgent: new HttpsProxyAgent(proxyUrl),
      httpAgent: new HttpProxyAgent(proxyUrl),
    };
  }

  private generateLimiterKey(url: string, config: HttpClientConfig): string {
    const hostname = new URL(url).hostname;
    const rps = config.rps || 'unlimited';
    return `${hostname}-${rps}`;
  }
}
