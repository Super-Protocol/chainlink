import { Type } from '@sinclair/typebox';

import { LOGGER_LEVELS } from '../constants';
import { variantsSchema } from '../utils/schema.util';

export const loggerSchema = Type.Object({
  level: Type.Optional(
    variantsSchema(LOGGER_LEVELS, {
      default: 'info',
      description:
        'Logging level for the application. Controls verbosity of log output.',
      examples: ['error', 'warn', 'info', 'debug'],
    }),
  ),
  isPrettyEnabled: Type.Optional(
    Type.Boolean({
      default: false,
      description: 'Enable pretty printing for logs',
    }),
  ),
});

export type LoggerConfig = typeof loggerSchema.static;
