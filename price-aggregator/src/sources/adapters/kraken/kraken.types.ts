export interface KrakenResponse {
  error: string[];
  result?: Record<
    string,
    {
      a: [string, number, number];
      b: [string, number, number];
      c: [string, string];
      v: [string, string];
      p: [string, string];
      t: [number, number];
      l: [string, string];
      h: [string, string];
      o: string;
    }
  >;
}

export interface KrakenAssetPairsResponse {
  error: string[];
  result?: Record<
    string,
    {
      altname: string;
      wsname: string;
      aclass_base: string;
      base: string;
      aclass_quote: string;
      quote: string;
      lot: string;
      pair_decimals: number;
      lot_decimals: number;
      lot_multiplier: number;
      leverage_buy: number[];
      leverage_sell: number[];
      fees: number[][];
      fees_maker: number[][];
      fee_volume_currency: string;
      margin_call: number;
      margin_stop: number;
      ordermin: string;
    }
  >;
}

export interface KrakenTickerData {
  symbol: string;
  bid: number;
  bid_qty: number;
  ask: number;
  ask_qty: number;
  last: number;
  volume: number;
  vwap: number;
  low: number;
  high: number;
  change: number;
  change_pct: number;
}

export interface KrakenWebSocketMessage {
  channel?: string;
  type?: 'snapshot' | 'update';
  data?: KrakenTickerData[];
}

export interface KrakenSubscribeRequest {
  method: 'subscribe';
  params: {
    channel: 'ticker';
    symbol: string[];
    event_trigger?: 'trades' | 'bbo';
    snapshot?: boolean;
  };
  req_id?: number;
}

export interface KrakenUnsubscribeRequest {
  method: 'unsubscribe';
  params: {
    channel: 'ticker';
    symbol: string[];
    event_trigger?: 'trades' | 'bbo';
  };
  req_id?: number;
}

export interface KrakenSubscribeResponse {
  method: 'subscribe' | 'unsubscribe';
  result?: {
    channel: string;
    symbol: string;
    snapshot?: boolean;
    event_trigger?: string;
  };
  success: boolean;
  error?: string;
  time_in: string;
  time_out: string;
  req_id?: number;
}

export interface KrakenWebSocketConfig {
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  pingInterval?: number;
  pongTimeout?: number;
}
