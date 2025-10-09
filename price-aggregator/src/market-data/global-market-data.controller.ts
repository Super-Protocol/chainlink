import { Controller, Get, NotFoundException, Post } from '@nestjs/common';

import { GlobalMarketDataResponseDto, GlobalMarketDataStatusDto } from './dto';
import { GlobalMarketDataService } from './global-market-data.service';

@Controller('market-data')
export class GlobalMarketDataController {
  constructor(
    private readonly globalMarketDataService: GlobalMarketDataService,
  ) {}

  @Get('global')
  getGlobalData(): GlobalMarketDataResponseDto {
    const data = this.globalMarketDataService.getData();

    if (!data) {
      throw new NotFoundException(
        'Global market data not available yet. Please try again in a few moments.',
      );
    }

    return {
      totalMarketCap: data.totalMarketCap,
      totalVolume: data.totalVolume,
      marketCapPercentage: data.marketCapPercentage,
      marketCapChangePercentage24h: data.marketCapChangePercentage24h,
      activeCryptocurrencies: data.activeCryptocurrencies,
      markets: data.markets,
      updatedAt: data.updatedAt.toISOString(),
    };
  }

  @Get('global/status')
  getStatus(): GlobalMarketDataStatusDto {
    const data = this.globalMarketDataService.getData();
    const isEnabled = this.globalMarketDataService.isEnabled();

    return {
      enabled: isEnabled,
      available: data !== null,
      dataAgeMs: this.globalMarketDataService.getDataAge(),
      lastUpdateAt: data?.updatedAt.toISOString() || null,
    };
  }

  @Post('global/refresh')
  async forceRefresh(): Promise<{ message: string }> {
    await this.globalMarketDataService.forceRefresh();
    return { message: 'Global market data refresh initiated' };
  }
}
