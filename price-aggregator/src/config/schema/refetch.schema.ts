import { Type } from '@sinclair/typebox';

export const refetchSchema = Type.Object(
  {
    enabled: Type.Boolean({
      default: true,
      description: 'Enable proactive cache refresh',
    }),
    staleTriggerBeforeExpiry: Type.Integer({
      minimum: 100,
      maximum: 60000,
      default: 3000,
      description: 'Milliseconds before expiry to trigger stale event',
    }),
    batchInterval: Type.Integer({
      minimum: 100,
      maximum: 10000,
      default: 1000,
      description: 'Milliseconds to wait for batching multiple stale items',
    }),
    minTimeBetweenRefreshes: Type.Integer({
      minimum: 100,
      maximum: 60000,
      default: 2000,
      description: 'Minimum milliseconds between refreshes for same item',
    }),
    failedPairsRetry: Type.Object(
      {
        enabled: Type.Boolean({
          default: true,
          description: 'Enable retry mechanism for failed pairs',
        }),
        maxAttempts: Type.Integer({
          minimum: 1,
          maximum: 1000,
          default: 50,
          description: 'Maximum number of retry attempts before giving up',
        }),
        retryDelay: Type.Integer({
          minimum: 1000,
          maximum: 3600000,
          default: 10000,
          description:
            'Fixed delay in milliseconds between retry attempts (10 seconds)',
        }),
        checkInterval: Type.Integer({
          minimum: 5000,
          maximum: 300000,
          default: 30000,
          description:
            'Interval in milliseconds to check for pairs ready to retry (30 seconds)',
        }),
      },
      {
        default: {},
        description: 'Configuration for retrying failed pair fetches',
      },
    ),
  },
  {
    default: {},
    description: 'Proactive cache refresh configuration',
  },
);
