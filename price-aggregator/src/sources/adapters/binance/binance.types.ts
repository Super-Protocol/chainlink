export interface BinanceTickerData {
  s: string; // symbol
  c: string; // close price
  E?: number; // event time
}

export interface WebSocketCommand {
  method: string;
  params: string[];
  id: number;
}
