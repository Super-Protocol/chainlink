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
    maxConcurrentRefreshes: Type.Integer({
      minimum: 1,
      maximum: 50,
      default: 10,
      description: 'Maximum number of concurrent refresh operations',
    }),
  },
  {
    default: {
      enabled: true,
      staleTriggerBeforeExpiry: 3000,
      batchInterval: 1000,
      minTimeBetweenRefreshes: 2000,
      maxConcurrentRefreshes: 10,
    },
    description: 'Proactive cache refresh configuration',
  },
);
