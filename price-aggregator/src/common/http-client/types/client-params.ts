import { UseProxyConfig } from '../../proxy';

export interface ClientParams {
  sourceName: string;
  timeoutMs: number;
  rps: number | null;
  maxConcurrent: number;
  useProxy: UseProxyConfig;
  maxRetries: number;
  baseUrl?: string;
  defaultParams?: Record<string, unknown>;
  customHeaders?: Record<string, string>;
}

export interface ClientOptions extends Omit<ClientParams, 'useProxy'> {
  proxyUrl?: string;
  customHeaders?: Record<string, string>;
}
