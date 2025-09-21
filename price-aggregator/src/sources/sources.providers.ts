import { AlphaVantageAdapter } from './adapters/alphavantage';
import { BinanceAdapter } from './adapters/binance';
import { CoinbaseAdapter } from './adapters/coinbase';
import { CoinGeckoAdapter } from './adapters/coingecko';
import { CryptoCompareAdapter } from './adapters/cryptocompare';
import { ExchangeRateHostAdapter } from './adapters/exchangerate-host';
import { FinnhubAdapter } from './adapters/finnhub';
import { FrankfurterAdapter } from './adapters/frankfurter';
import { KrakenAdapter } from './adapters/kraken';
import { OkxAdapter } from './adapters/okx';
import { SourceAdapter } from './source-adapter.interface';
import { SourceName } from './source-name.enum';

export const SOURCES_MAP: Record<
  SourceName,
  new (...args: unknown[]) => SourceAdapter
> = {
  [SourceName.ALPHAVANTAGE]: AlphaVantageAdapter,
  [SourceName.BINANCE]: BinanceAdapter,
  [SourceName.COINBASE]: CoinbaseAdapter,
  [SourceName.COINGECKO]: CoinGeckoAdapter,
  [SourceName.CRYPTOCOMPARE]: CryptoCompareAdapter,
  [SourceName.EXCHANGERATE_HOST]: ExchangeRateHostAdapter,
  [SourceName.FINNHUB]: FinnhubAdapter,
  [SourceName.FRANKFURTER]: FrankfurterAdapter,
  [SourceName.KRAKEN]: KrakenAdapter,
  [SourceName.OKX]: OkxAdapter,
};

export const SOURCES_PROVIDERS = [...Object.values(SOURCES_MAP)];
