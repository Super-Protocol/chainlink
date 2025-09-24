import { Static, Type } from '@sinclair/typebox';

import { SourceName } from '../../sources/source-name.enum';
import { variantsSchema } from '../utils/schema.util';

export const pairsTtlSchema = Type.Array(
  Type.Object({
    pair: Type.Array(Type.String(), {
      minItems: 2,
      maxItems: 2,
      description: 'Trading pair as array of two symbols [base, quote]',
      examples: [
        ['BTC', 'USDT'],
        ['ETH', 'USD'],
      ],
    }),
    source: Type.Optional(
      variantsSchema(Object.values(SourceName), {
        description: 'Source name for which this TTL applies',
      }),
    ),
    ttl: Type.Integer({
      minimum: 1000,
      description: 'Time to live for cached prices in milliseconds',
      examples: [15000, 30000, 60000],
    }),
  }),
  {
    description: 'Pair-specific TTL configuration overrides',
    default: [],
  },
);

export type PairsTtlConfig = Static<typeof pairsTtlSchema>;
