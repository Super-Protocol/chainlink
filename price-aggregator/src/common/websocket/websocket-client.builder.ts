import { Injectable } from '@nestjs/common';

import { ProxyConfigService, UseProxyConfig } from '../proxy';
import { WebSocketClient, WebSocketClientOptions } from './websocket-client';

export interface WebSocketClientParams {
  url: string;
  useProxy?: UseProxyConfig;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  pingInterval?: number;
  pongTimeout?: number;
  parseJson?: boolean;
}

@Injectable()
export class WebSocketClientBuilder {
  constructor(private readonly proxyConfigService: ProxyConfigService) {}

  build(params: WebSocketClientParams): WebSocketClient {
    // const proxyUrl = this.proxyConfigService.resolveProxyUrl(params.useProxy);
    const options: WebSocketClientOptions = {
      ...params,
      // proxyUrl,
    };

    return new WebSocketClient(options);
  }
}
