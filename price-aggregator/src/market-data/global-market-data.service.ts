import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';

import { GlobalMarketData, CoinGeckoGlobalResponse } from './interfaces';
import { HttpClient, HttpClientBuilder } from '../common';
import { AppConfigService } from '../config';
import { MetricsService } from '../metrics/metrics.service';

@Injectable()
export class GlobalMarketDataService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GlobalMarketDataService.name);
  private cachedData: GlobalMarketData | null = null;
  private refreshInterval: NodeJS.Timeout | null = null;
  private readonly httpClient: HttpClient;
  private readonly config: {
    enabled: boolean;
    refreshIntervalMs: number;
    useProxy: boolean;
  };

  constructor(
    httpClientBuilder: HttpClientBuilder,
    private readonly configService: AppConfigService,
    private readonly metricsService: MetricsService,
  ) {
    this.config = this.configService.get('marketData.coingeckoGlobal');

    this.httpClient = httpClientBuilder.build({
      sourceName: 'coingecko-global',
      timeoutMs: this.config.enabled ? 10000 : 5000,
      rps: 1,
      maxConcurrent: 1,
      useProxy: this.config.useProxy,
      maxRetries: 3,
      baseUrl: 'https://api.coingecko.com',
    });
  }

  onModuleInit(): void {
    if (!this.config.enabled) {
      this.logger.log('Global market data service is disabled');
      return;
    }

    this.logger.log('Initializing global market data service');
    this.refreshData().catch((error) => {
      this.logger.error(
        { error: (error as Error).message },
        'Failed initial refresh of global market data',
      );
    });

    this.refreshInterval = setInterval(() => {
      this.refreshData();
    }, this.config.refreshIntervalMs);

    this.logger.log(
      `Global market data refresh scheduled every ${this.config.refreshIntervalMs}ms`,
    );
  }

  onModuleDestroy(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.logger.log('Global market data service stopped');
    }
  }

  private async refreshData(): Promise<void> {
    try {
      this.logger.debug('Refreshing global market data');

      const { data } =
        await this.httpClient.get<CoinGeckoGlobalResponse>('/api/v3/global');

      if (!data?.data) {
        throw new Error('Invalid response from CoinGecko Global API');
      }

      this.cachedData = {
        totalMarketCap: data.data.total_market_cap,
        totalVolume: data.data.total_volume,
        marketCapPercentage: data.data.market_cap_percentage,
        marketCapChangePercentage24h:
          data.data.market_cap_change_percentage_24h_usd,
        activeCryptocurrencies: data.data.active_cryptocurrencies,
        markets: data.data.markets,
        updatedAt: new Date(data.data.updated_at * 1000),
      };

      this.metricsService.updateGlobalMarketDataMetrics(this.cachedData);

      this.logger.debug(
        { marketCap: this.cachedData.totalMarketCap.usd },
        'Global market data refreshed successfully',
      );
    } catch (error) {
      this.logger.error(
        { error: (error as Error).message },
        'Failed to refresh global market data',
      );
      this.metricsService.globalMarketDataErrors.inc();
    }
  }

  getData(): GlobalMarketData | null {
    return this.cachedData;
  }

  getDataAge(): number | null {
    if (!this.cachedData) {
      return null;
    }
    return Date.now() - this.cachedData.updatedAt.getTime();
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  async forceRefresh(): Promise<void> {
    if (!this.config.enabled) {
      throw new Error('Global market data service is disabled');
    }
    await this.refreshData();
  }
}
