import { Static, Type } from '@sinclair/typebox';

const createProxySchema = (protocol: 'HTTP' | 'HTTPS') =>
  Type.Union([
    Type.Object({
      enabled: Type.Literal(false, {
        description: `Disable ${protocol} proxy`,
        default: false,
      }),
    }),
    Type.Object({
      enabled: Type.Literal(true, {
        description: `Enable ${protocol} proxy`,
      }),
      host: Type.String({
        description: `${protocol} proxy host address`,
        examples: ['proxy.example.com', '192.168.1.100'],
        minLength: 1,
      }),
      port: Type.Integer({
        minimum: 1,
        maximum: 65535,
        description: `${protocol} proxy port`,
        examples: [8080, 3128],
      }),
      username: Type.Optional(
        Type.String({
          description: `${protocol} proxy username (if authentication required)`,
          examples: ['proxyuser'],
        }),
      ),
      password: Type.Optional(
        Type.String({
          description: `${protocol} proxy password (if authentication required)`,
          examples: ['proxypassword'],
        }),
      ),
    }),
  ]);

export const proxySchema = Type.Object({
  http: Type.Optional(createProxySchema('HTTP')),
  https: Type.Optional(createProxySchema('HTTPS')),
});

export type ProxyConfig = Static<typeof proxySchema>;
