import { Type } from '@sinclair/typebox';

export const pairCleanupSchema = Type.Object(
  {
    enabled: Type.Boolean({
      default: true,
      description: 'Enable automatic cleanup of inactive pairs',
    }),
    inactiveTimeoutMs: Type.Integer({
      minimum: 60000, // 1 minute minimum
      maximum: 86400000, // 24 hours maximum
      default: 7200000, // 2 hours default
      description:
        'Milliseconds after which inactive pairs are removed from tracking',
    }),
    cleanupIntervalMs: Type.Integer({
      minimum: 5000, // 5 seconds minimum
      maximum: 3600000, // 1 hour maximum
      default: 300000, // 5 minutes default
      description:
        'Interval in milliseconds for running cleanup of inactive pairs',
    }),
  },
  {
    description: 'Pair tracking and cleanup configuration',
  },
);
