import { Type, Static } from '@sinclair/typebox';

interface CreateSourceSchemaParams {
  sourceName: string;
  apiKeyRequired: boolean;
  apiKeyDescription: string;
  apiKeyExamples?: string[];
  apiKeyMinLength?: number;
  rpsDefault: number;
  maxConcurrentDefault?: number;
  maxBatchSize?: number;
  baseUrlDefault?: string;
}

const streamOptionsSchema = Type.Object(
  {
    autoReconnect: Type.Boolean({
      description: 'Enable automatic reconnection on disconnect',
      default: true,
    }),
    reconnectInterval: Type.Integer({
      minimum: 1000,
      description: 'Interval between reconnection attempts in ms',
      default: 5000,
    }),
    maxReconnectAttempts: Type.Integer({
      minimum: 0,
      maximum: 100,
      description: 'Maximum number of reconnection attempts',
      default: 10,
    }),
    heartbeatInterval: Type.Integer({
      minimum: 5000,
      description: 'Heartbeat ping interval in ms',
      default: 30000,
    }),
    wsUrl: Type.Optional(
      Type.String({
        description: 'WebSocket URL for streaming data',
        pattern: '^wss?://.+',
      }),
    ),
    batchSize: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 500,
        description:
          'Maximum number of pairs sent in one streaming subscribe/unsubscribe request to avoid rate limiting',
      }),
    ),
    rateLimit: Type.Optional(
      Type.Integer({
        minimum: 10,
        maximum: 10000,
        description:
          'Minimum milliseconds between WebSocket messages to avoid rate limiting (lower = faster)',
      }),
    ),
  },
  { additionalProperties: false },
);

const createSourceSchema = ({
  sourceName,
  apiKeyRequired,
  apiKeyDescription,
  apiKeyExamples = [],
  apiKeyMinLength = 1,
  rpsDefault,
  maxConcurrentDefault = 10,
  maxBatchSize,
  baseUrlDefault,
}: CreateSourceSchemaParams) => {
  return Type.Transform(
    Type.Object(
      {
        enabled: Type.Boolean({
          description: 'Enable or disable this price source',
          default: true,
        }),
        apiKey: Type.Optional(
          Type.String({
            description: apiKeyDescription,
            examples: apiKeyExamples,
            minLength: apiKeyMinLength,
          }),
        ),
        ttl: Type.Integer({
          minimum: 1000,
          description: 'Time to live for cached prices in milliseconds',
          default: 5000,
        }),
        maxConcurrent: Type.Integer({
          minimum: 1,
          description: 'Maximum number of concurrent requests',
          default: maxConcurrentDefault,
        }),
        timeoutMs: Type.Integer({
          minimum: 1000,
          description: 'Request timeout in milliseconds',
          default: 10000,
        }),
        rps: Type.Union(
          [
            Type.Number({
              minimum: 0.0001,
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
        useProxy: Type.Union(
          [
            Type.Boolean({
              description:
                'Use global proxy configuration from config.proxy.url',
            }),
            Type.String({
              description: 'Custom proxy URL for this source',
              pattern: '^https?://.+',
            }),
          ],
          {
            description:
              'Proxy configuration: true/false for global proxy, or URL string for custom proxy',
            default: false,
          },
        ),
        maxRetries: Type.Integer({
          minimum: 0,
          maximum: 10,
          description: 'Maximum number of retry attempts for failed requests',
          default: 3,
        }),
        refetch: Type.Boolean({
          description:
            'Enable automatic refetch of price data when cache expires',
          default: false,
        }),
        stream: Type.Optional(streamOptionsSchema),
        ...(baseUrlDefault && {
          baseUrl: Type.String({
            description: 'Base URL for API requests',
            pattern: '^https?://.+',
            default: baseUrlDefault,
          }),
        }),
        ...(maxBatchSize && {
          maxBatchSize: Type.Integer({
            minimum: 1,
            maximum: 1000,
            description: 'Maximum number of pairs in a single batch request',
            default: maxBatchSize,
          }),
        }),
      },
      {
        default: {},
      },
    ),
  )
    .Decode((value) => {
      if (!value.enabled) {
        return value;
      }

      if (apiKeyRequired && (!value.apiKey || value.apiKey.trim() === '')) {
        throw new Error(
          `API key is required when source is enabled (source: ${sourceName}, path: sources.${sourceName}.apiKey)`,
        );
      }

      return value;
    })
    .Encode((value) => value);
};

export const binanceSourceSchema = createSourceSchema({
  sourceName: 'binance',
  apiKeyRequired: false,
  apiKeyDescription:
    'Optional API key for Binance (not required for public market data)',
  apiKeyExamples: ['your-binance-api-key'],
  rpsDefault: 100,
  maxBatchSize: 500,
  baseUrlDefault: 'https://api.binance.us',
});

export const okxSourceSchema = createSourceSchema({
  sourceName: 'okx',
  apiKeyRequired: false,
  apiKeyDescription:
    'Optional API key for OKX (not required for public market data)',
  apiKeyExamples: ['your-okx-api-key'],
  rpsDefault: 10,
  maxBatchSize: 200,
});

export const finnhubSourceSchema = createSourceSchema({
  sourceName: 'finnhub',
  apiKeyRequired: true,
  apiKeyDescription: 'Required API key for Finnhub (free: 60 requests/minute)',
  apiKeyExamples: ['your-finnhub-api-key'],
  apiKeyMinLength: 2,
  rpsDefault: 1,
});

export const cryptocompareSourceSchema = createSourceSchema({
  sourceName: 'cryptocompare',
  apiKeyRequired: true,
  apiKeyDescription:
    'Required API key for CryptoCompare (free: 100,000 requests/month)',
  apiKeyExamples: ['your-cryptocompare-api-key'],
  rpsDefault: 25,
  maxBatchSize: 50,
});

export const alphavantageSourceSchema = createSourceSchema({
  sourceName: 'alphavantage',
  apiKeyRequired: true,
  apiKeyDescription:
    'Required API key for Alpha Vantage (free: 25 requests/day)',
  apiKeyExamples: ['DEMO_KEY', 'your-alpha-vantage-api-key'],
  rpsDefault: 1,
});

export const coingeckoSourceSchema = createSourceSchema({
  sourceName: 'coingecko',
  apiKeyRequired: false,
  apiKeyDescription:
    'Optional API key for CoinGecko Pro (increases rate limits)',
  apiKeyExamples: ['your-coingecko-pro-api-key'],
  rpsDefault: 1,
  maxBatchSize: 100,
});

export const exchangerateSourceSchema = createSourceSchema({
  sourceName: 'exchangeratehost',
  apiKeyRequired: false,
  apiKeyDescription:
    'Optional API key for ExchangeRate Host (paid plans have higher limits)',
  apiKeyExamples: ['your-exchangerate-host-api-key'],
  rpsDefault: 1,
});

export const krakenSourceSchema = createSourceSchema({
  sourceName: 'kraken',
  apiKeyRequired: false,
  apiKeyDescription:
    'Optional API key for Kraken (not required for public market data)',
  apiKeyExamples: ['your-kraken-api-key'],
  rpsDefault: 1,
  maxBatchSize: 50,
});

export const coinbaseSourceSchema = createSourceSchema({
  sourceName: 'coinbase',
  apiKeyRequired: false,
  apiKeyDescription:
    'Optional API key for Coinbase (not required for public market data)',
  apiKeyExamples: ['your-coinbase-api-key'],
  rpsDefault: 2.8,
});

export const frankfurterSourceSchema = createSourceSchema({
  sourceName: 'frankfurter',
  apiKeyRequired: false,
  apiKeyDescription: 'No API key required for Frankfurter (no strict limits)',
  apiKeyExamples: [],
  rpsDefault: 10,
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

export type SourcesConfig = Static<typeof sourcesSchema>;
