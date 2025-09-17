import { Type } from '@sinclair/typebox';

import { variantsSchema } from '../utils/schema.util';

const basePriceSourceSchema = Type.Object({
  enabled: Type.Boolean({
    description: 'Enable or disable this price source',
    default: true,
  }),
  ttl: Type.Integer({
    minimum: 1000,
    description: 'Time to live for cached prices in milliseconds',
    default: 10000,
  }),
  timeoutMs: Type.Integer({
    minimum: 1000,
    description: 'Request timeout in milliseconds',
    default: 10000,
  }),
});

const createUpdateTypeSchema = (supportedTypes: string[]) =>
  variantsSchema(supportedTypes, {
    description: 'Update mechanism for this source',
    default: supportedTypes.includes('events') ? 'events' : supportedTypes[0],
  });

export const binanceSourceSchema = Type.Intersect([
  basePriceSourceSchema,
  Type.Object({
    updateType: createUpdateTypeSchema(['events', 'batch', 'onDemand']),
    apiKey: Type.Optional(
      Type.String({
        description:
          'Optional API key for Binance (not required for public market data)',
        examples: ['your-binance-api-key'],
      }),
    ),
  }),
]);

export const okxSourceSchema = Type.Intersect([
  basePriceSourceSchema,
  Type.Object({
    updateType: createUpdateTypeSchema(['events', 'batch', 'onDemand']),
    apiKey: Type.Optional(
      Type.String({
        description:
          'Optional API key for OKX (not required for public market data)',
        examples: ['your-okx-api-key'],
      }),
    ),
  }),
]);

export const finnhubSourceSchema = Type.Intersect([
  basePriceSourceSchema,
  Type.Object({
    updateType: createUpdateTypeSchema(['events', 'onDemand']),
    apiKey: Type.String({
      description: 'Required API key for Finnhub (free: 60 requests/minute)',
      examples: ['your-finnhub-api-key'],
    }),
  }),
]);

export const cryptocompareSourceSchema = Type.Intersect([
  basePriceSourceSchema,
  Type.Object({
    updateType: createUpdateTypeSchema(['events', 'batch', 'onDemand']),
    apiKey: Type.String({
      description:
        'Required API key for CryptoCompare (free: 100,000 requests/month)',
      examples: ['your-cryptocompare-api-key'],
    }),
    useProxy: Type.Optional(
      Type.Boolean({
        description: 'Use proxy for requests (useful to bypass rate limits)',
        default: false,
      }),
    ),
  }),
]);

export const alphavantageSourceSchema = Type.Intersect([
  basePriceSourceSchema,
  Type.Object({
    updateType: createUpdateTypeSchema(['onDemand']),
    apiKey: Type.String({
      description: 'Required API key for Alpha Vantage (free: 25 requests/day)',
      examples: ['DEMO_KEY', 'your-alpha-vantage-api-key'],
    }),
  }),
]);

export const coingeckoSourceSchema = Type.Intersect([
  basePriceSourceSchema,
  Type.Object({
    updateType: createUpdateTypeSchema(['batch', 'onDemand']),
    apiKey: Type.Optional(
      Type.String({
        description:
          'Optional API key for CoinGecko Pro (increases rate limits)',
        examples: ['your-coingecko-pro-api-key'],
      }),
    ),
  }),
]);

export const exchangerateSourceSchema = Type.Intersect([
  basePriceSourceSchema,
  Type.Object({
    updateType: createUpdateTypeSchema(['batch', 'onDemand']),
    apiKey: Type.Optional(
      Type.String({
        description:
          'Optional API key for ExchangeRate Host (paid plans have higher limits)',
        examples: ['your-exchangerate-host-api-key'],
      }),
    ),
  }),
]);

export const krakenSourceSchema = Type.Intersect([
  basePriceSourceSchema,
  Type.Object({
    updateType: createUpdateTypeSchema(['events', 'batch', 'onDemand']),
    apiKey: Type.Optional(
      Type.String({
        description:
          'Optional API key for Kraken (not required for public market data)',
        examples: ['your-kraken-api-key'],
      }),
    ),
  }),
]);

export const coinbaseSourceSchema = Type.Intersect([
  basePriceSourceSchema,
  Type.Object({
    updateType: createUpdateTypeSchema(['events', 'batch', 'onDemand']),
    apiKey: Type.Optional(
      Type.String({
        description:
          'Optional API key for Coinbase (not required for public market data)',
        examples: ['your-coinbase-api-key'],
      }),
    ),
  }),
]);

export const frankfurterSourceSchema = Type.Intersect([
  basePriceSourceSchema,
  Type.Object({
    updateType: createUpdateTypeSchema(['batch', 'onDemand']),
  }),
]);

export const sourcesSchema = Type.Object(
  {
    binance: binanceSourceSchema,
    okx: okxSourceSchema,
    finnhub: finnhubSourceSchema,
    cryptocompare: cryptocompareSourceSchema,
    alphavantage: alphavantageSourceSchema,
    coingecko: coingeckoSourceSchema,
    exchangeratehost: exchangerateSourceSchema,
    kraken: krakenSourceSchema,
    coinbase: coinbaseSourceSchema,
    frankfurter: frankfurterSourceSchema,
  },
  { default: {} },
);

export type SourcesConfig = typeof sourcesSchema.static;
