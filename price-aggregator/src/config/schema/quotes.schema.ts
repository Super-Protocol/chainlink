import { Static, Type } from '@sinclair/typebox';

export const quotesSchema = Type.Object(
  {
    requestTimeoutMs: Type.Integer({
      minimum: 1000,
      maximum: 60000,
      default: 10000,
      description:
        'Maximum time to wait for quote request response in milliseconds. After this time, user gets timeout error but request continues in background.',
    }),
  },
  {
    default: {},
    description: 'Quote request configuration',
  },
);

export type QuotesConfig = Static<typeof quotesSchema>;
