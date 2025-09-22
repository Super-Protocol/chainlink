import { Pair } from '../../source-adapter.interface';

export interface FinnhubSymbolInfo {
  symbol: string;
  assetType: 'crypto';
}

const QUOTE_PATH = '/api/v1/quote';

export function getSymbolAndEndpoint(
  pair: Pair,
): FinnhubSymbolInfo & { endpoint: string } {
  const [base, quote] = pair;
  const baseUpper = base.toUpperCase();
  const quoteUpper = quote.toUpperCase();

  const symbol = `BINANCE:${baseUpper}${quoteUpper}`;
  return { symbol, endpoint: QUOTE_PATH, assetType: 'crypto' };
}

export function pairToSymbol(pair: Pair): string {
  return getSymbolAndEndpoint(pair).symbol;
}
