# API Comparison Matrix

This document provides a comparative analysis of various price data APIs used in the project.

## Feature Support Matrix

| API Provider      | Batch Requests | WebSocket/Real-time | API Key Required           | Rate Limits (Free Tier)                                                         |
| ----------------- | -------------- | ------------------- | -------------------------- | ------------------------------------------------------------------------------- |
| OKX               | ✅             | ✅                  | ❌ (public) / ✅ (private) | • 20 requests per 2 seconds (public) <br> • 60 requests per minute (private)    |
| Kraken            | ✅             | ✅                  | ❌ (public) / ✅ (private) | • Counter-based system <br> • ~1 request per second (starter tier)              |
| Frankfurter       | ✅             | ❌                  | ❌                         | • No strict limits <br> • "Be sensible" policy                                  |
| Finnhub           | ❌             | ✅                  | ✅                         | • 60 API calls per minute                                                       |
| ExchangeRate Host | ✅             | ❌                  | ❌ (free) / ✅ (paid)      | • 1,000 requests per day (free)                                                 |
| CryptoCompare     | ✅             | ✅                  | ✅                         | • 100,000 requests per month <br> • 25 requests per second                      |
| CoinGecko         | ✅             | ❌                  | ❌ (public) / ✅ (pro)     | • 10-30 requests per minute per IP                                              |
| Coinbase          | ✅             | ✅                  | ❌ (public) / ✅ (private) | • 10,000 requests per hour                                                      |
| Binance           | ✅             | ✅                  | ❌ (public) / ✅ (private) | • Weight-based: 6,000/minute <br> • Price endpoint: weight 2 (single), 40 (all) |
| Alpha Vantage     | ❌             | ❌                  | ✅                         | • 25 requests per day                                                           |

## Detailed Analysis

### Best for High-Frequency Updates

- **WebSocket Support**: OKX, Kraken, Finnhub, CryptoCompare, Coinbase, Binance
- These providers are ideal for real-time price tracking

### Best for Batch Operations

- **Full Batch Support**: OKX, Kraken, Frankfurter, ExchangeRate Host, CryptoCompare, CoinGecko, Coinbase, Binance
- Particularly efficient: Binance (all pairs in one request), CoinGecko (multiple currencies)

### Most Liberal Rate Limits (Free Tier)

1. Frankfurter (no strict limits)
2. Coinbase (10,000/hour)
3. CryptoCompare (100,000/month)

### Most Restrictive Rate Limits (Free Tier)

1. Alpha Vantage (25/day)
2. ExchangeRate Host (1,000/day)
3. Finnhub (60/minute)

### API Key Requirements

- **No Key Required for Public Data**: OKX, Kraken, Frankfurter, ExchangeRate Host (free tier), CoinGecko (public), Coinbase (public), Binance (public)
- **Always Requires Key**: Finnhub, CryptoCompare, Alpha Vantage

## Recommendations

### For High-Volume Production Use

1. **Cryptocurrency Data**:
   - Primary: Binance or OKX (high limits, WebSocket support)
   - Backup: CryptoCompare or Kraken

2. **Forex/Currency Data**:
   - Primary: Frankfurter (no strict limits)
   - Backup: ExchangeRate Host or Alpha Vantage (with paid plan)

### For Development/Testing

- Use Frankfurter or CoinGecko's public API (generous limits, no key required)
- Avoid Alpha Vantage free tier (very restrictive limits)

### For Real-time Updates

- Prefer WebSocket providers: Binance, OKX, Kraken, Coinbase
- Implement fallback to REST APIs with appropriate rate limiting

## Notes

- Rate limits and features may change; always check the official documentation
- Consider implementing multiple providers for redundancy
- Some providers offer increased limits with paid plans
- WebSocket connections often have their own connection/subscription limits
