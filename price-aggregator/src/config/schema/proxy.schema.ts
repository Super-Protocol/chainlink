import { Type } from '@sinclair/typebox';

export const proxySchema = Type.Object({
  http: Type.Optional(
    Type.Object({
      enabled: Type.Boolean({
        description: 'Enable HTTP proxy',
        default: false,
      }),
      host: Type.Optional(
        Type.String({
          description: 'HTTP proxy host address',
          examples: ['proxy.example.com', '192.168.1.100'],
        }),
      ),
      port: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: 65535,
          description: 'HTTP proxy port',
          examples: [8080, 3128],
        }),
      ),
      username: Type.Optional(
        Type.String({
          description: 'HTTP proxy username (if authentication required)',
          examples: ['proxyuser'],
        }),
      ),
      password: Type.Optional(
        Type.String({
          description: 'HTTP proxy password (if authentication required)',
          examples: ['proxypassword'],
        }),
      ),
    }),
  ),
  https: Type.Optional(
    Type.Object({
      enabled: Type.Boolean({
        description: 'Enable HTTPS proxy',
        default: false,
      }),
      host: Type.Optional(
        Type.String({
          description: 'HTTPS proxy host address',
          examples: ['proxy.example.com', '192.168.1.100'],
        }),
      ),
      port: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: 65535,
          description: 'HTTPS proxy port',
          examples: [8080, 3128],
        }),
      ),
      username: Type.Optional(
        Type.String({
          description: 'HTTPS proxy username (if authentication required)',
          examples: ['proxyuser'],
        }),
      ),
      password: Type.Optional(
        Type.String({
          description: 'HTTPS proxy password (if authentication required)',
          examples: ['proxypassword'],
        }),
      ),
    }),
  ),
});

export type ProxyConfig = typeof proxySchema.static;
