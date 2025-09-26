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
  rateLimitPerInterval?: number;
  rateLimitIntervalMs?: number;
}

@Injectable()
export class WebSocketClientBuilder {
  build(params: WebSocketClientParams): WebSocketClient {
    return new WebSocketClient(params);
  }
}
