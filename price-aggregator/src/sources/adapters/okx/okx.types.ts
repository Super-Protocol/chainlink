export interface OkxTickerData {
  instType: string;
  instId: string;
  last: string;
  lastSz: string;
  askPx: string;
  askSz: string;
  bidPx: string;
  bidSz: string;
  open24h: string;
  high24h: string;
  low24h: string;
  sodUtc0: string;
  sodUtc8: string;
  volCcy24h: string;
  vol24h: string;
  ts: string;
}

export interface OkxWebSocketMessage {
  event?: string;
  code?: string;
  msg?: string;
  connId?: string;
  arg?: {
    channel: string;
    instType?: string;
    instId?: string;
  };
  data?: OkxTickerData[];
}

export interface OkxWebSocketConfig {
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  pingInterval?: number;
  pongTimeout?: number;
}

export interface OkxSubscribeRequest {
  op: 'subscribe' | 'unsubscribe';
  args: Array<{
    channel: string;
    instType?: string;
    instId?: string;
  }>;
}
