# Kraken API Documentation

## 1. Does the API support batch price requests

Yes, Kraken REST API allows requesting data for multiple trading pairs in a single request. You can pass multiple pairs in the `pair` parameter of the `GET /0/public/Ticker` endpoint, separated by commas.

**Parameters:**

- `pair` (STRING, MANDATORY): List of trading pairs separated by commas (e.g., `XXBTZUSD,XETHZUSD`).

**Request Example:**
`https://api.kraken.com/0/public/Ticker?pair=XXBTZUSD,XETHZUSD`

## 2. Can you subscribe to pairs and receive events

Yes, Kraken provides a WebSocket API (Kraken Websockets API 2.0) for subscribing to real-time market data. You can subscribe to various channels, including:

- `ticker`: Receive ticker data.
- `ohlc`: Candlestick data.
- `trade`: Trade information.
- `book`: Order book.

## 3. How to request price for a pair

To request a ticker (which includes the latest price) for a single trading pair, use the `GET /0/public/Ticker` endpoint.

**Parameters:**

- `pair` (STRING, MANDATORY): Trading pair (e.g., `XXBTZUSD`). _Note: Kraken uses its own pair notation, for example, `XBT` for Bitcoin._

**Request Example:**
`https://api.kraken.com/0/public/Ticker?pair=XXBTZUSD`

In the response, the latest price will be in the `c` (close) field.

## 4. Limitations and API Key Requirements

- **API Key**:
  - Public endpoints, such as `/0/public/Ticker`, do **not require** an API key.
  - Key is required for private endpoints (account management, orders).

- **Rate Limits**:
  - Kraken uses a counter-based system. Each API call increases your counter. The counter decreases over time.
  - **Starter tier**: Maximum counter value is 15. It decreases by 1 every second. The `Ticker` endpoint has a "weight" of 1.
  - Therefore, at the starter tier, you can make about 1 request per second.
  - Higher account verification levels increase the maximum counter value.
  - WebSocket API also has its own connection and subscription limits.
