export * from '../interfaces/http-client.interface';
export * from './client-params';

export interface RequestQueueItem {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  data?: unknown;
  config?: unknown;
  timestamp: number;
}

export interface RateLimitingOptions {
  enabled: boolean;
  rps?: number | null;
  maxConcurrent?: number;
}
