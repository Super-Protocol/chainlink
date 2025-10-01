# Kraken API Documentation

Official REST API documentation: [https://docs.kraken.com/rest/](https://docs.kraken.com/rest/)
Official WebSocket API documentation: [https://docs.kraken.com/websockets/](https://docs.kraken.com/websockets/)

## 1. How to request a price for a pair (single endpoint)

To request a ticker for a single trading pair, use the `GET /0/public/Ticker` endpoint.

**Parameters:**

- `pair` (STRING, MANDATORY): The trading pair (e.g., `XBT/USD`). Note: Kraken uses its own pair notation.

**Request Example:**
`https://api.kraken.com/0/public/Ticker?pair=XBT/USD`

In the response, the latest price will be in the `c` (close) array.

## 2. Does the API support batch price requests

Yes, the Kraken REST API allows requesting data for multiple trading pairs in a single request. You can pass multiple comma-separated pairs in the `pair` parameter of the `GET /0/public/Ticker` endpoint.

**Parameters:**

- `pair` (STRING, MANDATORY): A comma-separated list of trading pairs (e.g., `XBT/USD,ETH/USD`).

**Request Example:**
`https://api.kraken.com/0/public/Ticker?pair=XBT/USD,ETH/USD`

## 3. Can you subscribe to pairs and receive events (streaming)

Yes, Kraken provides a WebSocket API for subscribing to real-time market data. The production WebSocket endpoint is `wss://ws.kraken.com`.

You can subscribe to various channels, including `ticker`, `ohlc`, `trade`, and `book`.

**Subscription Message Example:**

```json
{
  "method": "subscribe",
  "params": {
    "channel": "ticker",
    "symbol": ["BTC/USD"]
  }
}
```

## 4. Limitations and API Key Requirements

- **API Key**:
  - Public endpoints, such as `/0/public/Ticker`, do **not require** an API key.
  - An API key is required for private endpoints (e.g., account management, orders).

- **Rate Limits**:
  - Kraken uses a counter-based system ("IP request counter"). Each API call increases your counter, which decreases over time.
  - **Starter tier**: The maximum counter value is 15, and it decreases by 1 every second. The `Ticker` endpoint has a "cost" of 1.
  - Higher account verification levels increase the maximum counter value, allowing for more frequent requests.
  - The WebSocket API has its own connection and subscription limits.
