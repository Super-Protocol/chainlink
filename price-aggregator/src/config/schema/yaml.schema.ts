import { Type } from '@sinclair/typebox';

import { NODE_ENVIRONMENTS } from '../constants';
import { loggerSchema } from './logger.schema';
import { marketDataSchema } from './market-data.schema';
import { metricsPushSchema } from './metrics-push.schema';
import { pairCleanupSchema } from './pair-cleanup.schema';
import { pairsTtlSchema } from './pairs-ttl.schema';
import { proxySchema } from './proxy.schema';
import { refetchSchema } from './refetch.schema';
import { sourcesSchema } from './sources.schema';
import { variantsSchema } from '../utils/schema.util';

export const yamlValidationSchema = Type.Object(
  {
    port: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 65535,
        default: 3000,
        description: 'Port for the HTTP server',
      }),
    ),
    environment: Type.Optional(
      variantsSchema(NODE_ENVIRONMENTS, {
        default: 'development',
        description: 'Application environment mode',
      }),
    ),
    pairsFilePath: Type.Optional(
      Type.String({
        description: 'Path to pairs configuration file',
      }),
    ),
    logger: loggerSchema,
    metricsPush: metricsPushSchema,
    sources: sourcesSchema,
    proxy: Type.Optional(proxySchema),
    refetch: refetchSchema,
    pairCleanup: pairCleanupSchema,
    pairsTtl: Type.Optional(pairsTtlSchema),
    marketData: marketDataSchema,
  },
  {
    default: {},
  },
);
