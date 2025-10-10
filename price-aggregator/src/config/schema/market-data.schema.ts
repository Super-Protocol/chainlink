import { Type } from '@sinclair/typebox';

export const marketDataSchema = Type.Object(
  {
    coingeckoGlobal: Type.Object(
      {
        enabled: Type.Boolean({
          description: 'Enable global market data fetching from CoinGecko',
          default: true,
        }),
        refreshIntervalMs: Type.Integer({
          minimum: 10000,
          description:
            'Interval between automatic refreshes of global market data in milliseconds',
          default: 60000,
        }),
        useProxy: Type.Boolean({
          description: 'Use proxy for global market data requests',
          default: false,
        }),
      },
      { default: {} },
    ),
  },
  { default: {} },
);
