import { AxiosRequestConfig, AxiosResponse } from 'axios';

export interface ProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface RpsLimiterConfig {
  maxConcurrent: number;
  minTime: number;
  reservoirRefreshInterval?: number;
  reservoirRefreshAmount?: number;
}

export interface HttpClientConfig {
  timeoutMs: number;
  rps?: number | null;
  maxConcurrent?: number;
  useProxy?: boolean;
  proxyConfig?: ProxyConfig;
  maxRetries?: number;
  baseUrl?: string;
  defaultParams?: Record<string, unknown>;
}

export interface HttpClient {
  get<T>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>>;
  post<T, D>(
    url: string,
    data?: D,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>>;
  put<T, D>(
    url: string,
    data?: D,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>>;
  patch<T, D>(
    url: string,
    data?: D,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>>;
  delete<T>(
    url: string,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>>;
}
