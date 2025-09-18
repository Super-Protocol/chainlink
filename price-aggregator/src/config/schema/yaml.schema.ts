import { Type } from '@sinclair/typebox';

import { NODE_ENVIRONMENTS } from '../constants';
import { loggerSchema } from './logger.schema';
import { proxySchema } from './proxy.schema';
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
    logger: loggerSchema,
    sources: sourcesSchema,
    proxy: Type.Optional(proxySchema),
  },
  {
    default: {},
  },
);
