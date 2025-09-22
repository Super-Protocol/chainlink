export interface BinanceTickerData {
  s: string; // symbol
  c: string; // close price
  E?: number; // event time
}

export interface BinanceStreamMessage {
  stream?: string;
  data?: BinanceTickerData;
}

export interface WebSocketCommand {
  method: string;
  params: string[];
  id: number;
}

export interface BinanceWebSocketConfig {
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  pingInterval?: number;
  pongTimeout?: number;
}
