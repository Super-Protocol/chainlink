import { Type, Static } from '@sinclair/typebox';

export const metricsPushSchema = Type.Object(
  {
    enabled: Type.Boolean({
      default: false,
      description: 'Enable push metrics to external collector',
    }),
    url: Type.Optional(
      Type.String({
        description: 'Push gateway endpoint URL (required when enabled)',
      }),
    ),
    intervalMs: Type.Integer({
      minimum: 1000,
      default: 30000,
      description: 'Push interval in milliseconds',
    }),
    jobName: Type.String({
      default: 'price-aggregator',
      description: 'Job name for grouping metrics',
    }),
    groupingLabels: Type.Record(Type.String(), Type.String(), {
      description: 'Additional grouping labels for metrics',
      default: {},
    }),
    basicAuth: Type.Optional(
      Type.Object(
        {
          username: Type.String({ description: 'Basic auth username' }),
          password: Type.String({ description: 'Basic auth password' }),
        },
        {
          description: 'Basic authentication credentials',
        },
      ),
    ),
    headers: Type.Record(Type.String(), Type.String(), {
      description: 'Additional HTTP headers',
      default: {},
    }),
    timeoutMs: Type.Integer({
      minimum: 100,
      default: 5000,
      description: 'Request timeout in milliseconds',
    }),
    batchSize: Type.Integer({
      minimum: 1,
      default: 100,
      description: 'Number of metrics per batch when pushing',
    }),
  },
  {
    description: 'Push metrics configuration',
    default: {},
  },
);

export type MetricsPushConfig = Static<typeof metricsPushSchema>;
