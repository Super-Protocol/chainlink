import { Type } from '@sinclair/typebox';

const createApiKeySchema = (
  required: boolean = false,
  description: string,
  examples: string[] = [],
) =>
  Type.Object({
    apiKey: required
      ? Type.String({ description, examples })
      : Type.Optional(Type.String({ description, examples })),
  });

interface CreateSourceSchemaParams {
  apiKeyRequired: boolean;
  apiKeyDescription: string;
  apiKeyExamples?: string[];
  rpsDefault: number;
  maxConcurrentDefault?: number;
}

const createSourceSchema = ({
  apiKeyRequired,
  apiKeyDescription,
  apiKeyExamples = [],
  rpsDefault,
  maxConcurrentDefault = 10,
}: CreateSourceSchemaParams) =>
  Type.Intersect([
    Type.Object({
      enabled: Type.Boolean({
        description: 'Enable or disable this price source',
        default: true,
      }),
      ttl: Type.Integer({
        minimum: 1000,
        description: 'Time to live for cached prices in milliseconds',
        default: 10000,
      }),
      maxConcurrent: Type.Optional(
        Type.Integer({
          minimum: 1,
          description: 'Maximum number of concurrent requests',
          default: maxConcurrentDefault,
        }),
      ),
      timeoutMs: Type.Integer({
        minimum: 1000,
        description: 'Request timeout in milliseconds',
        default: 10000,
      }),
      rps: Type.Optional(
        Type.Union(
          [
            Type.Number({
              minimum: 0.001,
              maximum: 1000,
              description:
                'Requests per second limit to prevent API rate limiting',
            }),
            Type.Null({
              description: 'Disable RPS limiting',
            }),
          ],
          {
            default: rpsDefault,
            description:
              'Requests per second limit to prevent API rate limiting. Set to null to disable limiting',
          },
        ),
      ),
      useProxy: Type.Optional(
        Type.Boolean({
          description: 'Use proxy for requests (useful to bypass rate limits)',
          default: false,
        }),
      ),
    }),
    createApiKeySchema(apiKeyRequired, apiKeyDescription, apiKeyExamples),
  ]);

export const binanceSourceSchema = createSourceSchema({
  apiKeyRequired: false,
  apiKeyDescription:
    'Optional API key for Binance (not required for public market data)',
  apiKeyExamples: ['your-binance-api-key'],
  rpsDefault: 100, // 6000 requests per minute = 100 RPS
});

export const okxSourceSchema = createSourceSchema({
  apiKeyRequired: false,
  apiKeyDescription:
    'Optional API key for OKX (not required for public market data)',
  apiKeyExamples: ['your-okx-api-key'],
  rpsDefault: 10, // 20 requests per 2 seconds = 10 RPS
});

export const finnhubSourceSchema = createSourceSchema({
  apiKeyRequired: true,
  apiKeyDescription: 'Required API key for Finnhub (free: 60 requests/minute)',
  apiKeyExamples: ['your-finnhub-api-key'],
  rpsDefault: 1, // 60 requests per minute = 1 RPS
});

export const cryptocompareSourceSchema = createSourceSchema({
  apiKeyRequired: true,
  apiKeyDescription:
    'Required API key for CryptoCompare (free: 100,000 requests/month)',
  apiKeyExamples: ['your-cryptocompare-api-key'],
  rpsDefault: 25, // 25 requests per second
});

export const alphavantageSourceSchema = createSourceSchema({
  apiKeyRequired: true,
  apiKeyDescription:
    'Required API key for Alpha Vantage (free: 25 requests/day)',
  apiKeyExamples: ['DEMO_KEY', 'your-alpha-vantage-api-key'],
  rpsDefault: 0.0003, // 25 requests per day ≈ 0.0003 RPS
});

export const coingeckoSourceSchema = createSourceSchema({
  apiKeyRequired: false,
  apiKeyDescription:
    'Optional API key for CoinGecko Pro (increases rate limits)',
  apiKeyExamples: ['your-coingecko-pro-api-key'],
  rpsDefault: 0.5, // 30 requests per minute = 0.5 RPS
});

export const exchangerateSourceSchema = createSourceSchema({
  apiKeyRequired: false,
  apiKeyDescription:
    'Optional API key for ExchangeRate Host (paid plans have higher limits)',
  apiKeyExamples: ['your-exchangerate-host-api-key'],
  rpsDefault: 0.012, // 1000 requests per day ≈ 0.012 RPS
});

export const krakenSourceSchema = createSourceSchema({
  apiKeyRequired: false,
  apiKeyDescription:
    'Optional API key for Kraken (not required for public market data)',
  apiKeyExamples: ['your-kraken-api-key'],
  rpsDefault: 1, // ~1 request per second (starter tier)
});

export const coinbaseSourceSchema = createSourceSchema({
  apiKeyRequired: false,
  apiKeyDescription:
    'Optional API key for Coinbase (not required for public market data)',
  apiKeyExamples: ['your-coinbase-api-key'],
  rpsDefault: 2.8, // 10000 requests per hour ≈ 2.8 RPS
});

export const frankfurterSourceSchema = createSourceSchema({
  apiKeyRequired: false,
  apiKeyDescription: 'No API key required for Frankfurter (no strict limits)',
  apiKeyExamples: [],
  rpsDefault: 10, // No strict limits, conservative default
});

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
