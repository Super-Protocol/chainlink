# OKX API Documentation

Official documentation: [https://www.okx.com/docs-v5/en/](https://www.okx.com/docs-v5/en/)

## 1. How to request a price for a pair (single endpoint)

To request a ticker for a single trading pair, use the `GET /api/v5/market/ticker` endpoint.

**Parameters:**

- `instId` (STRING, MANDATORY): The instrument ID (trading pair), e.g., `BTC-USDT`.

**Request Example:**
`https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT`

The latest price will be in the `last` field of the response.

## 2. Does the API support batch price requests

Yes, the OKX REST API (v5) allows retrieving data for multiple tickers in a single request using the `GET /api/v5/market/tickers` endpoint.

**Parameters:**

- `instType` (STRING, MANDATORY): The instrument type, e.g., `SPOT` or `SWAP`.
- `uly` (STRING, OPTIONAL): The underlying asset identifier to get data for all pairs with this asset.

**Request Example:**
`https://www.okx.com/api/v5/market/tickers?instType=SPOT`

This request will return tickers for all SPOT pairs.

## 3. Can you subscribe to pairs and receive events (streaming)

Yes, OKX provides a WebSocket API for subscribing to real-time market data. The public WebSocket endpoint is `wss://ws.okx.com:8443/ws/v5/public`.

You can subscribe to the `tickers` channel to receive updates for specific trading pairs.

**Subscription Message Example:**

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

## 4. Limitations and API Key Requirements

- **API Key**:
  - Public endpoints, such as market data retrieval, do **not require** an API key.
  - An API key is required for private endpoints (e.g., trading, account management).

- **Rate Limits**:
  - Public endpoints: **20 requests per 2 seconds** per IP.
  - Private endpoints: **60 requests per 2 seconds** per API key (for non-VIP users).
  - Limits may vary for different endpoints and user VIP levels.
  - The WebSocket API has its own connection and subscription limits (e.g., 300 subscriptions per connection).
