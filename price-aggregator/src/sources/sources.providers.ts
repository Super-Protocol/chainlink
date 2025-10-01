import { AlphaVantageAdapter } from './adapters/alphavantage';
import { BinanceAdapter } from './adapters/binance';
import { BinanceStreamService } from './adapters/binance/binance-stream.service';
import { CoinbaseAdapter } from './adapters/coinbase';
import { CoinbaseStreamService } from './adapters/coinbase/coinbase-stream.service';
import { CoinGeckoAdapter } from './adapters/coingecko';
import { CryptoCompareAdapter } from './adapters/cryptocompare';
import { CryptoCompareStreamService } from './adapters/cryptocompare/cryptocompare-stream.service';
import { ExchangeRateHostAdapter } from './adapters/exchangerate-host';
import { FinnhubAdapter } from './adapters/finnhub';
import { FinnhubStreamService } from './adapters/finnhub/finnhub-stream.service';
import { FrankfurterAdapter } from './adapters/frankfurter';
import { KrakenAdapter } from './adapters/kraken';
import { KrakenStreamService } from './adapters/kraken/kraken-stream.service';
import { OkxAdapter } from './adapters/okx';
import { OkxStreamService } from './adapters/okx/okx-stream.service';
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

export const STREAM_PROVIDERS = [
  BinanceStreamService,
  CoinbaseStreamService,
  CryptoCompareStreamService,
  FinnhubStreamService,
  KrakenStreamService,
  OkxStreamService,
];

export const SOURCES_PROVIDERS = [
  ...Object.values(SOURCES_MAP),
  ...STREAM_PROVIDERS,
];
