import { Static, Type } from '@sinclair/typebox';

export const proxySchema = Type.Optional(
  Type.String({
    description:
      'Proxy URL (https recommended). Format: https://[user:pass@]host:port',
    examples: [
      'https://proxy.example.com:8080',
      'https://user:pass@proxy.example.com:8080',
    ],
    pattern: '^https?://.+',
  }),
);

export type ProxyConfig = Static<typeof proxySchema>;
