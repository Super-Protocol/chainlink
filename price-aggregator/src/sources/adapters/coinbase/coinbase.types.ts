export interface CoinbaseTickerData {
  type: 'ticker';
  product_id: string;
  price: string;
  volume_24_h: string;
  low_24_h: string;
  high_24_h: string;
  low_52_w: string;
  high_52_w: string;
  price_percent_chg_24_h: string;
  best_bid: string;
  best_ask: string;
  best_bid_quantity: string;
  best_ask_quantity: string;
}

export interface CoinbaseSubscribeMessage {
  type: 'subscribe';
  product_ids: string[];
  channel: string;
  jwt?: string;
}

export interface CoinbaseUnsubscribeMessage {
  type: 'unsubscribe';
  product_ids: string[];
  channel: string;
  jwt?: string;
}

export interface CoinbaseSubscriptionsMessage {
  type: 'subscriptions';
  channels: Array<{
    name: string;
    product_ids: string[];
  }>;
}

export interface CoinbaseErrorMessage {
  type: 'error';
  message: string;
  reason?: string;
}

export interface CoinbaseHeartbeatMessage {
  type: 'heartbeat';
  sequence: number;
  last_trade_id: number;
  product_id: string;
  time: string;
}

export interface CoinbaseTickerEvent {
  type: 'snapshot' | 'update';
  tickers: CoinbaseTickerData[];
}

export interface CoinbaseSubscriptionEvent {
  subscriptions: {
    ticker: string[];
  };
}

export interface CoinbaseAdvancedTradeMessage {
  channel: string;
  client_id: string;
  timestamp: string;
  sequence_num: number;
  events: (CoinbaseTickerEvent | CoinbaseSubscriptionEvent)[];
}

export type CoinbaseWebSocketMessage =
  | CoinbaseTickerData
  | CoinbaseSubscriptionsMessage
  | CoinbaseErrorMessage
  | CoinbaseHeartbeatMessage
  | CoinbaseAdvancedTradeMessage;

export interface CoinbaseWebSocketConfig {
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  pingInterval?: number;
  pongTimeout?: number;
}
