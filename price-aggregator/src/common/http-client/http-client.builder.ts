import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';

import { ConfiguredHttpClient } from './configured-http-client';
import { RpsLimiterService } from './rps-limiter.service';
import {
  CustomClientParams,
  HttpClient,
  HttpClientConfig,
  ProxyConfig,
  ClientParams,
} from './types';
import { AppConfigService } from '../../config';

@Injectable()
export class HttpClientBuilder {
  constructor(
    private readonly httpService: HttpService,
    private readonly rpsLimiter: RpsLimiterService,
    private readonly configService: AppConfigService,
  ) {}

  build(params: ClientParams): HttpClient {
    const clientConfig: HttpClientConfig = {
      timeoutMs: params.timeoutMs,
      rps: params.rps,
      useProxy: params.useProxy || false,
      proxyConfig: params.proxyConfig,
      maxRetries: params.maxRetries || 3,
      maxConcurrent: params.maxConcurrent || 10,
      baseUrl: params.baseUrl,
      defaultParams: params.defaultParams,
    };

    if (clientConfig.useProxy && !clientConfig.proxyConfig) {
      clientConfig.proxyConfig = this.getProxyConfig();
    }

    return this.createClient(clientConfig);
  }

  buildCustom(params: CustomClientParams = {}): HttpClient {
    const clientConfig: HttpClientConfig = {
      timeoutMs: params.timeoutMs || 10000,
      rps: params.rps,
      useProxy: params.useProxy || false,
      proxyConfig: params.proxyConfig,
      maxRetries: params.maxRetries || 3,
      maxConcurrent: params.maxConcurrent || 10,
      baseUrl: params.baseUrl,
      defaultParams: params.defaultParams,
    };

    if (clientConfig.useProxy && !clientConfig.proxyConfig) {
      clientConfig.proxyConfig = this.getProxyConfig();
    }

    return this.createClient(clientConfig);
  }

  private getProxyConfig(): ProxyConfig | undefined {
    const proxyConfig = this.configService.get('proxy');

    if (!proxyConfig) {
      return undefined;
    }

    const httpProxy = proxyConfig.http;
    const httpsProxy = proxyConfig.https;

    let proxy = null;
    if (httpProxy?.enabled) {
      proxy = httpProxy;
    } else if (httpsProxy?.enabled) {
      proxy = httpsProxy;
    }

    if (!proxy || !proxy.host || !proxy.port) {
      return undefined;
    }

    return {
      host: proxy.host,
      port: proxy.port,
      username: proxy.username,
      password: proxy.password,
    };
  }

  private createClient(clientConfig: HttpClientConfig): HttpClient {
    return new ConfiguredHttpClient(
      clientConfig,
      this.httpService,
      this.rpsLimiter,
    );
  }
}
