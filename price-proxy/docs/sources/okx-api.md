# OKX API Documentation

## 1. Does the API support batch price requests

Yes, OKX REST API (v5) allows retrieving data for multiple tickers (trading pairs) in a single request. This is done using the `GET /api/v5/market/tickers` endpoint.

**Parameters:**

- `instType` (STRING, MANDATORY): Instrument type, e.g., `SPOT`, `SWAP`.
- `uly` (STRING, OPTIONAL): Underlying asset identifier to get data for all pairs with this asset.

**Request Example:**
`https://www.okx.com/api/v5/market/tickers?instType=SPOT`

This request will return tickers for all spot pairs.

## 2. Can you subscribe to pairs and receive events

Yes, OKX provides a WebSocket API for subscribing to real-time market data. You can subscribe to the `tickers` channel to receive updates for specific trading pairs.

**Subscription Example:**

```json
{
  "op": "subscribe",
  "args": [
    {
      "channel": "tickers",
      "instId": "BTC-USDT"
    }
  ]
}
```

## 3. How to request price for a pair

To request a ticker containing the latest price for a single trading pair, use the `GET /api/v5/market/ticker` endpoint.

**Parameters:**

- `instId` (STRING, MANDATORY): Instrument ID (trading pair), e.g., `BTC-USDT`.

**Request Example:**
`https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT`

The latest price will be in the `last` field.

## 4. Limitations and API Key Requirements

- **API Key**:
  - Public endpoints, such as market data retrieval, do **not require** an API key.
  - Key is required for private endpoints (trading, account management).

- **Rate Limits**:
  - Public endpoints: **20 requests per 2 seconds**.
  - Private endpoints: **60 requests per minute** (for non-VIP users).
  - Limits may vary for different endpoints and user levels.
  - WebSocket API also has its own connection and subscription limits.
