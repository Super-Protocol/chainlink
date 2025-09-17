import { Type } from '@sinclair/typebox';
import { LOGGER_LEVELS, NODE_ENVIRONMENTS } from '../constants';
import {
  booleanFromString,
  numberFromString,
  portFromString,
  positiveNumberFromString,
  variantsSchema,
} from '../utils/schema.util';

export const envValidationSchema = Type.Object({
  NODE_ENV: variantsSchema(NODE_ENVIRONMENTS, {
    default: 'development',
    description: 'Application environment mode',
  }),
  PORT: portFromString(3000, {
    description: 'Port for the HTTP server',
  }),
  LOGGER_LEVEL: variantsSchema(LOGGER_LEVELS, {
    default: 'info',
    description:
      'Logging level for the application. Controls verbosity of log output.',
    examples: ['error', 'warn', 'info', 'debug'],
  }),
  LOGGER_PRETTY_ENABLED: booleanFromString('false', {
    description: 'Enable pretty printing for logs',
  }),
  PRICE_PROXY_REFRESH_INTERVAL_MS: positiveNumberFromString(30000, {
    description: 'Interval for refreshing price data in milliseconds',
  }),
  PRICE_PROXY_REQUEST_TIMEOUT_MS: positiveNumberFromString(10000, {
    description: 'HTTP request timeout in milliseconds',
  }),
  PRICE_PROXY_MAX_RETRIES: positiveNumberFromString(3, {
    description: 'Maximum number of retries for failed requests',
  }),
});
