export interface YahooFinanceResponse {
  chart: {
    result?: Array<{
      meta: {
        regularMarketPrice?: number;
        symbol: string;
        currency?: string;
        exchangeName?: string;
      };
      timestamp?: number[];
      indicators?: {
        quote: Array<{
          close?: number[];
        }>;
      };
    }>;
    error?: {
      code: string;
      description: string;
    };
  };
}
