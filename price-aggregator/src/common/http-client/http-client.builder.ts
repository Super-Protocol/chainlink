import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';

import { ConfiguredHttpClient } from './configured-http-client';
import { RpsLimiterService } from './rps-limiter.service';
import {
  HttpClient,
  ProxyConfiguration,
  ClientParams,
  ClientParamsWithProxy,
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
    const proxyConfig = params.useProxy ? this.getProxyConfig() : null;

    if (params.useProxy && !proxyConfig) {
      throw new Error(
        'Proxy is enabled (useProxy = true), but no proxy configuration was provided or resolved from config.',
      );
    }

    return this.createClient({
      ...params,
      proxyConfig,
    });
  }

  private getProxyConfig(): ProxyConfiguration | null {
    const proxyConfig = this.configService.get('proxy');

    if (!proxyConfig) {
      return null;
    }

    const httpProxy = proxyConfig.http;
    const httpsProxy = proxyConfig.https;

    const hasEnabledProxy =
      (httpProxy?.enabled && httpProxy.host && httpProxy.port) ||
      (httpsProxy?.enabled && httpsProxy.host && httpsProxy.port);

    if (!hasEnabledProxy) {
      return null;
    }

    return {
      http: httpProxy?.enabled ? httpProxy : undefined,
      https: httpsProxy?.enabled ? httpsProxy : undefined,
    };
  }

  private createClient(config: ClientParamsWithProxy): HttpClient {
    return new ConfiguredHttpClient(config, this.httpService, this.rpsLimiter);
  }
}
