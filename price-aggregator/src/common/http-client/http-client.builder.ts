import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';

import { ConfiguredHttpClient } from './configured-http-client';
import { RpsLimiterService } from './rps-limiter.service';
import {
  HttpClient,
  ProxyConfig,
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

    return this.createClient({
      ...params,
      proxyConfig,
    });
  }

  private getProxyConfig(): ProxyConfig | null {
    const proxyConfig = this.configService.get('proxy');

    if (!proxyConfig) {
      return undefined;
    }

    const httpProxy = proxyConfig.http;
    const httpsProxy = proxyConfig.https;

    let proxy: ProxyConfig | null = null;
    if (httpProxy?.enabled) {
      proxy = httpProxy;
    } else if (httpsProxy?.enabled) {
      proxy = httpsProxy;
    }

    if (!proxy || !proxy.host || !proxy.port) {
      return null;
    }

    return proxy;
  }

  private createClient(config: ClientParamsWithProxy): HttpClient {
    return new ConfiguredHttpClient(config, this.httpService, this.rpsLimiter);
  }
}
