import { Value } from '@sinclair/typebox/value';
import { envValidationSchema } from '../schema';
import { Config } from '../types';
import { handleValidationError } from '../utils/validation-error.util';

export function envLoader(): Config {
  try {
    const parsedEnvs = Value.Parse(envValidationSchema, process.env);

    return {
      port: parsedEnvs.PORT,
      environment: parsedEnvs.NODE_ENV,
      logger: {
        level: parsedEnvs.LOGGER_LEVEL,
        isPrettyEnabled: parsedEnvs.LOGGER_PRETTY_ENABLED,
      },
      priceProxy: {
        refreshIntervalMs: parsedEnvs.PRICE_PROXY_REFRESH_INTERVAL_MS,
        requestTimeoutMs: parsedEnvs.PRICE_PROXY_REQUEST_TIMEOUT_MS,
        maxRetries: parsedEnvs.PRICE_PROXY_MAX_RETRIES,
      },
    };
  } catch (error) {
    handleValidationError(error, 'Failed to load environment variables');
  }
}
