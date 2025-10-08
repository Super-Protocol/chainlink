export interface KucoinResponse {
  code: string;
  data: {
    time: number;
    sequence: string;
    price: string;
    size: string;
    bestBid: string;
    bestBidSize: string;
    bestAsk: string;
    bestAskSize: string;
  };
}

export interface KucoinSymbolsResponse {
  code: string;
  data: Array<{
    symbol: string;
    name: string;
    baseCurrency: string;
    quoteCurrency: string;
    baseMinSize: string;
    quoteMinSize: string;
    baseMaxSize: string;
    quoteMaxSize: string;
    baseIncrement: string;
    quoteIncrement: string;
    priceIncrement: string;
    enableTrading: boolean;
    isMarginEnabled: boolean;
    market: string;
  }>;
}
