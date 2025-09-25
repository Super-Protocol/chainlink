import { Injectable } from '@nestjs/common';

import { UseProxyConfig } from './proxy.types';
import { AppConfigService } from '../../config';

@Injectable()
export class ProxyConfigService {
  constructor(private readonly configService: AppConfigService) {}

  getProxyUrl(): string | null {
    return this.configService.get('proxy') || null;
  }

  isProxyEnabled(): boolean {
    return this.getProxyUrl() !== null;
  }

  resolveProxyUrl(useProxyConfig: UseProxyConfig): string | undefined {
    if (!useProxyConfig) {
      return undefined;
    }

    if (typeof useProxyConfig === 'string') {
      return useProxyConfig;
    }

    const url = this.getProxyUrl();
    if (!url) {
      throw new Error(
        'Proxy is enabled but no proxy URL was provided or resolved from config.',
      );
    }

    return url;
  }
}
