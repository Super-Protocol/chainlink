import { AlphaVantageAdapter } from './adapters/alphavantage.adapter';
import { BinanceAdapter } from './adapters/binance.adapter';
import { CoinbaseAdapter } from './adapters/coinbase.adapter';
import { CoinGeckoAdapter } from './adapters/coingecko.adapter';
import { CryptoCompareAdapter } from './adapters/cryptocompare.adapter';
import { ExchangeRateHostAdapter } from './adapters/exchangerate-host.adapter';
import { FinnhubAdapter } from './adapters/finnhub.adapter';
import { FrankfurterAdapter } from './adapters/frankfurter.adapter';
import { KrakenAdapter } from './adapters/kraken.adapter';
import { OkxAdapter } from './adapters/okx.adapter';
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

export const SOURCES_PROVIDERS = Object.values(SOURCES_MAP);
