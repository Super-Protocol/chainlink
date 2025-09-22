import { isAxiosError } from 'axios';

import {
  PriceNotFoundException,
  SourceApiException,
  SourceException,
  SourceUnauthorizedException,
} from '../exceptions';
import { Pair } from '../source-adapter.interface';
import { SourceName } from '../source-name.enum';

export function HandleSourceError() {
  return function (
    _target: unknown,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
      try {
        return await originalMethod.apply(this, args);
      } catch (error) {
        if (error instanceof SourceException) {
          throw error;
        }

        const sourceName = this.name as SourceName;

        if (isAxiosError(error)) {
          const status = error.response?.status;
          if (
            (status === 400 || status === 404) &&
            propertyKey === 'fetchQuote'
          ) {
            const pair = args[0] as Pair;
            throw new PriceNotFoundException(pair, sourceName);
          }

          if (
            status === 400 &&
            error.response?.data?.msg === 'Invalid symbol.'
          ) {
            const pair = args[0] as Pair;
            throw new PriceNotFoundException(pair, sourceName);
          }

          if (status === 401) {
            throw new SourceUnauthorizedException(sourceName);
          }
        }

        if (
          error.message?.toLowerCase().includes('unknown asset pair') &&
          propertyKey === 'fetchQuote'
        ) {
          const pair = args[0] as Pair;
          throw new PriceNotFoundException(pair, sourceName);
        }

        throw new SourceApiException(sourceName, error as Error);
      }
    };

    return descriptor;
  };
}
