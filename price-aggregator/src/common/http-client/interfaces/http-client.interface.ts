import { AxiosRequestConfig, AxiosResponse } from 'axios';

export interface ProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  protocol?: 'http' | 'https';
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
