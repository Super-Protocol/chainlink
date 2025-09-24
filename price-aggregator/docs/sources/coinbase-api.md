# Coinbase API Documentation

Official documentation: [https://docs.cloud.coinbase.com/exchange/reference/](https://docs.cloud.coinbase.com/exchange/reference/)

## 1. How to request a price for a pair (single endpoint)

To request the current spot price for a single trading pair, use the `GET /products/{product_id}/ticker` endpoint from the Exchange API.

**Parameters:**

- `product_id` (STRING, MANDATORY): The trading pair identifier, separated by a hyphen (e.g., `BTC-USD`).

**Request Example:**
`https://api.exchange.coinbase.com/products/BTC-USD/ticker`

## 2. Does the API support batch price requests

No, the Coinbase Exchange REST API does **not** directly support batch requests for multiple tickers in a single call. You need to make a separate request for each trading pair.

However, the `GET /products` endpoint can be used to get a list of all available trading pairs, which can then be used to make individual ticker requests.

## 3. Can you subscribe to pairs and receive events (streaming)

Yes, Coinbase provides a WebSocket feed for subscribing to real-time market data. The WebSocket endpoint is `wss://ws-feed.exchange.coinbase.com`.

To receive price updates, you can subscribe to the `ticker` channel for specific products.

**Subscription Message Example:**

```json
{
  "type": "subscribe",
  "product_ids": ["ETH-BTC", "ETH-USD"],
  "channels": ["ticker"]
}
```

## 4. Limitations and API Key Requirements

- **API Key**:
  - Public endpoints, such as getting product tickers, do **not require** an API key.
  - Authentication is required for private endpoints (e.g., placing orders, accessing account data).

- **Rate Limits**:
  - Public endpoints are limited to **10 requests per second**, with bursts of up to 15 requests per second.
  - Private endpoints have a limit of **15 requests per second**, with bursts of up to 30 requests per second.
  - It is recommended to use the WebSocket feed for real-time data to avoid hitting REST API rate limits.
