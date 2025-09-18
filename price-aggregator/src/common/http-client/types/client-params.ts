import { ProxyConfig } from './index';

export interface ClientParams {
  sourceName: string;
  timeoutMs: number;
  rps?: number | null;
  useProxy?: boolean;
  proxyConfig?: ProxyConfig;
  maxRetries?: number;
  maxConcurrent?: number;
  baseUrl?: string;
  defaultParams?: Record<string, unknown>;
}

export interface CustomClientParams {
  timeoutMs?: number;
  rps?: number | null;
  useProxy?: boolean;
  proxyConfig?: ProxyConfig;
  maxRetries?: number;
  maxConcurrent?: number;
  baseUrl?: string;
  defaultParams?: Record<string, unknown>;
}

export interface BasicClientParams {
  timeoutMs: number;
  rps?: number | null;
  useProxy?: boolean;
}
