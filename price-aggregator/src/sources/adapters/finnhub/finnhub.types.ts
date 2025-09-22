export interface FinnhubTradeData {
  s: string;
  p: number;
  v?: number;
  t: number;
  c?: string[];
  dp?: number;
}

export interface FinnhubWebSocketMessage {
  type: 'trade' | 'ping';
  data?: FinnhubTradeData[];
}

export interface FinnhubSubscribeCommand {
  type: 'subscribe' | 'unsubscribe';
  symbol: string;
}

export interface FinnhubWebSocketConfig {
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  pingInterval?: number;
  pongTimeout?: number;
}
