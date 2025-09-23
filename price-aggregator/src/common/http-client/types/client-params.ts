import { ProxyConfig } from '../interfaces/http-client.interface';

export interface ClientParams {
  sourceName: string;
  timeoutMs: number;
  rps: number | null;
  maxConcurrent: number;
  useProxy: boolean;
  maxRetries: number;
  baseUrl?: string;
  defaultParams?: Record<string, unknown>;
}

export interface ClientParamsWithProxy extends ClientParams {
  proxyConfig: ProxyConfig;
}

export interface BasicClientParams {
  timeoutMs: number;
  rps?: number | null;
  useProxy?: boolean;
}
