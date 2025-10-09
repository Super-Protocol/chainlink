export class GlobalMarketDataResponseDto {
  totalMarketCap: Record<string, number>;
  totalVolume: Record<string, number>;
  marketCapPercentage: Record<string, number>;
  marketCapChangePercentage24h: number;
  activeCryptocurrencies: number;
  markets: number;
  updatedAt: string;
}

export class GlobalMarketDataStatusDto {
  enabled: boolean;
  available: boolean;
  dataAgeMs: number | null;
  lastUpdateAt: string | null;
}
