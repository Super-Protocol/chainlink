import axios from 'axios';

export interface CoinGeckoCoin {
  id: string;
  symbol: string;
  name: string;
}

const coinListCache: {
  promise: Promise<Map<string, string>> | null;
  timestamp: number;
} = {
  promise: null,
  timestamp: 0,
};

const CACHE_TTL = 24 * 60 * 60 * 1000;

async function fetchCoinList(): Promise<Map<string, string>> {
  const { data } = await axios.get<CoinGeckoCoin[]>(
    'https://api.coingecko.com/api/v3/coins/list',
  );

  const symbolToIdMap = new Map<string, string>();
  for (const coin of data) {
    const symbol = coin.symbol.toLowerCase();
    if (!symbolToIdMap.has(symbol)) {
      symbolToIdMap.set(symbol, coin.id);
    }
  }
  return symbolToIdMap;
}

export function getCoinIdMap(): Promise<Map<string, string>> {
  const now = Date.now();
  if (!coinListCache.promise || now - coinListCache.timestamp > CACHE_TTL) {
    coinListCache.promise = fetchCoinList();
    coinListCache.timestamp = now;
  }
  return coinListCache.promise;
}
