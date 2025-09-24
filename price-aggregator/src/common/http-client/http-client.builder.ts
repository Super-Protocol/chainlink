import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';

import { ProxyConfigService } from '../proxy';
import { ConfiguredHttpClient } from './configured-http-client';
import { RpsLimiterService } from './rps-limiter.service';
import { HttpClient, ClientParams } from './types';

@Injectable()
export class HttpClientBuilder {
  constructor(
    private readonly httpService: HttpService,
    private readonly rpsLimiter: RpsLimiterService,
    private readonly proxyConfigService: ProxyConfigService,
  ) {}

  build(params: ClientParams): HttpClient {
    const proxyUrl = this.proxyConfigService.resolveProxyUrl(params.useProxy);

    return new ConfiguredHttpClient(
      { ...params, proxyUrl },
      this.httpService,
      this.rpsLimiter,
    );
  }
}
